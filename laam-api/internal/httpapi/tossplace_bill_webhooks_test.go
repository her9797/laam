package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
)

func seedBillWebhookOrder(t *testing.T, orderID string, posOrderID string, amount int64, status string) {
	t.Helper()
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO payment_orders (id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, pos_order_id)
		VALUES ($1, '하우스 하이볼', '하이볼', 'T-03', $2, $3, 'SUCCEEDED', $4)
	`, orderID, amount, status, posOrderID); err != nil {
		t.Fatalf("seed payment order: %v", err)
	}
	if _, err := testRepo.EnsurePOSBill(t.Context(), posOrderID); err != nil {
		t.Fatalf("EnsurePOSBill: %v", err)
	}
}

func orderEventBody(t *testing.T, eventType string, posOrderID string, orderKey string) []byte {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"id":        "evt-" + posOrderID,
		"type":      eventType,
		"createdAt": "2026-09-01T13:00:00.000Z",
		"data": map[string]any{
			"orderId":     posOrderID,
			"orderKey":    orderKey,
			"orderNumber": "N-1",
			"source":      "POS",
			"completedAt": "2026-09-01T13:00:00.000Z",
			"cancelledAt": "2026-09-01T13:30:00.000Z",
		},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return body
}

func paymentEventBody(t *testing.T, eventType string, payment string) []byte {
	t.Helper()
	return []byte(`{"id":"evt-pay","type":"` + eventType + `","createdAt":"2026-09-01T13:00:00.000Z","merchantId":42,"data":{"payment":` + payment + `}}`)
}

func orderStatuses(t *testing.T, posOrderID string) map[string]string {
	t.Helper()
	rows, err := testPool.Query(t.Context(), `SELECT id, status FROM payment_orders WHERE pos_order_id = $1`, posOrderID)
	if err != nil {
		t.Fatalf("query orders: %v", err)
	}
	defer rows.Close()
	statuses := map[string]string{}
	for rows.Next() {
		var id, status string
		if err := rows.Scan(&id, &status); err != nil {
			t.Fatalf("scan: %v", err)
		}
		statuses[id] = status
	}
	return statuses
}

func billPayments(t *testing.T, posOrderID string) map[string]string {
	t.Helper()
	rows, err := testPool.Query(t.Context(), `
		SELECT p.id, p.state || '/' || p.source_type || '/' || p.amount::text
		FROM pos_payments p JOIN pos_bills b ON b.id = p.bill_id
		WHERE b.pos_order_id = $1
	`, posOrderID)
	if err != nil {
		t.Fatalf("query payments: %v", err)
	}
	defer rows.Close()
	payments := map[string]string{}
	for rows.Next() {
		var id, summary string
		if err := rows.Scan(&id, &summary); err != nil {
			t.Fatalf("scan: %v", err)
		}
		payments[id] = summary
	}
	return payments
}

const splitPaymentsJSON = `[
	{"id":"pay-card","orderId":"pos-table-1","state":"APPROVED","sourceType":"CARD","paymentMethod":"신용카드","amount":12000,"taxAmount":1091,"supplyAmount":10909,"taxExemptAmount":0,"approvedNo":"A1","approvedAt":"2026-09-01T13:00:00Z","cardDetails":{"cardBrand":"신한","cardNo":"1234-****"}},
	{"id":"pay-transfer","orderId":"pos-table-1","state":"APPROVED","sourceType":"ACCOUNT_TRANSFER","paymentMethod":"계좌이체","amount":8000,"taxAmount":727,"supplyAmount":7273,"taxExemptAmount":0,"approvedNo":"","approvedAt":"2026-09-01T13:00:00Z"}
]`

// In plugin mode the POS order's orderKey is the first web order's id, and
// later web orders on the same table are appended to it. Completing the
// POS order must complete all of them and record its split payments.
func TestTossPlaceWebhook_CompletedEventCompletesWholeBillAndStoresPayments(t *testing.T) {
	tossServer := mockTossPlaceServer(t,
		map[string]string{"pos-table-1": `{"resultType":"SUCCESS","success":{"id":"pos-table-1","orderState":"COMPLETED","chargePrice":{"totalAmount":20000,"discountAmount":0},"lineItems":[
			{"item":{"title":"하우스 하이볼","category":{"title":"하이볼"}},"itemPrice":{"priceValue":11000},"quantity":1,"optionChoices":[]},
			{"item":{"title":"하우스 하이볼","category":{"title":"하이볼"}},"itemPrice":{"priceValue":9000},"quantity":1,"optionChoices":[]}
		]}}`},
		map[string]string{"pos-table-1": splitPaymentsJSON},
	)
	defer tossServer.Close()
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, tossServer.URL))
	seedBillWebhookOrder(t, "order-first", "pos-table-1", 11000, "READY")
	seedBillWebhookOrder(t, "order-second", "pos-table-1", 9000, "ACKNOWLEDGED")

	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, orderEventBody(t, "order.order.completed.v1", "pos-table-1", "order-first"), false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	statuses := orderStatuses(t, "pos-table-1")
	if len(statuses) != 2 || statuses["order-first"] != "DONE" || statuses["order-second"] != "DONE" {
		t.Fatalf("statuses = %v, want both DONE and no POS-native rows", statuses)
	}
	payments := billPayments(t, "pos-table-1")
	if len(payments) != 2 || payments["pay-card"] != "APPROVED/CARD/12000" || payments["pay-transfer"] != "APPROVED/ACCOUNT_TRANSFER/8000" {
		t.Fatalf("payments = %v", payments)
	}
	var status string
	var total int64
	var synced bool
	if err := testPool.QueryRow(t.Context(), `
		SELECT status, COALESCE(total_amount, 0), payments_synced_at IS NOT NULL FROM pos_bills WHERE pos_order_id = 'pos-table-1'
	`).Scan(&status, &total, &synced); err != nil {
		t.Fatalf("query bill: %v", err)
	}
	if status != "PAID" || total != 20000 || !synced {
		t.Fatalf("bill = %s/%d/synced=%v, want PAID/20000/true", status, total, synced)
	}
}

// Staff can add items on the POS to a table that already has web orders;
// only those extra items become POS-native rows, and a retried delivery
// must not add them twice.
func TestTossPlaceWebhook_CompletedEventRecordsOnlyPOSAddedItemsOnMixedBill(t *testing.T) {
	tossServer := mockTossPlaceServer(t,
		map[string]string{"pos-mixed": `{"resultType":"SUCCESS","success":{"id":"pos-mixed","orderKey":"toss-native-key","orderState":"COMPLETED","completedAt":"2026-09-01T13:00:00Z","lineItems":[
			{"item":{"title":"하우스 하이볼","category":{"title":"하이볼"}},"itemPrice":{"priceValue":11000},"quantity":1,"optionChoices":[]},
			{"item":{"title":"생맥주","category":{"title":"맥주"}},"itemPrice":{"priceValue":6000},"quantity":2,"optionChoices":[]}
		]}}`},
		map[string]string{"pos-mixed": `[]`},
	)
	defer tossServer.Close()
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, tossServer.URL))
	seedBillWebhookOrder(t, "order-web", "pos-mixed", 11000, "READY")

	body := orderEventBody(t, "order.order.completed.v1", "pos-mixed", "toss-native-key")
	for attempt := 0; attempt < 2; attempt++ {
		if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false); rec.Code != http.StatusOK {
			t.Fatalf("attempt %d status = %d", attempt, rec.Code)
		}
	}

	statuses := orderStatuses(t, "pos-mixed")
	if len(statuses) != 2 || statuses["order-web"] != "DONE" {
		t.Fatalf("statuses = %v, want the web order DONE plus one POS-native row", statuses)
	}
	var name string
	var amount int64
	var linked bool
	if err := testPool.QueryRow(t.Context(), `
		SELECT menu_item_name, amount, bill_id IS NOT NULL FROM payment_orders WHERE pos_order_id = 'pos-mixed' AND id <> 'order-web'
	`).Scan(&name, &amount, &linked); err != nil {
		t.Fatalf("query native row: %v", err)
	}
	if name != "생맥주" || amount != 12000 || !linked {
		t.Fatalf("native row = %s/%d/linked=%v, want 생맥주/12000/true", name, amount, linked)
	}
}

func TestTossPlaceWebhook_POSNativeOrderGetsABillWithPayments(t *testing.T) {
	tossServer := mockTossPlaceServer(t,
		map[string]string{"pos-native": `{"resultType":"SUCCESS","success":{"id":"pos-native","orderState":"COMPLETED","completedAt":"2026-09-01T13:00:00Z","lineItems":[
			{"item":{"title":"생맥주","category":{"title":"맥주"}},"itemPrice":{"priceValue":6000},"quantity":1,"optionChoices":[]}
		]}}`},
		map[string]string{"pos-native": `[{"id":"pay-cash","orderId":"pos-native","state":"APPROVED","sourceType":"CASH","paymentMethod":"현금","amount":6000,"taxAmount":545,"supplyAmount":5455,"taxExemptAmount":0,"approvedNo":"","approvedAt":"2026-09-01T13:00:00Z"}]`},
	)
	defer tossServer.Close()
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, tossServer.URL))

	if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, orderEventBody(t, "order.order.completed.v1", "pos-native", "toss-key"), false); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var billStatus string
	var linked bool
	if err := testPool.QueryRow(t.Context(), `
		SELECT b.status, o.bill_id = b.id
		FROM pos_bills b JOIN payment_orders o ON o.pos_order_id = b.pos_order_id
		WHERE b.pos_order_id = 'pos-native'
	`).Scan(&billStatus, &linked); err != nil {
		t.Fatalf("query bill: %v", err)
	}
	if billStatus != "PAID" || !linked {
		t.Fatalf("bill = %s linked=%v, want PAID/true", billStatus, linked)
	}
	if payments := billPayments(t, "pos-native"); payments["pay-cash"] != "APPROVED/CASH/6000" {
		t.Fatalf("payments = %v", payments)
	}
}

func TestTossPlaceWebhook_CancelledEventCancelsWholeBill(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	seedBillWebhookOrder(t, "order-a", "pos-cancel", 11000, "DONE")
	seedBillWebhookOrder(t, "order-b", "pos-cancel", 9000, "READY")

	if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, orderEventBody(t, "order.order.cancelled.v1", "pos-cancel", "order-a"), false); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	statuses := orderStatuses(t, "pos-cancel")
	if statuses["order-a"] != "CANCELLED" || statuses["order-b"] != "CANCELLED" {
		t.Fatalf("statuses = %v, want both CANCELLED", statuses)
	}
	var billStatus string
	if err := testPool.QueryRow(t.Context(), `SELECT status FROM pos_bills WHERE pos_order_id = 'pos-cancel'`).Scan(&billStatus); err != nil {
		t.Fatalf("query bill: %v", err)
	}
	if billStatus != "CANCELLED" {
		t.Fatalf("bill status = %q, want CANCELLED", billStatus)
	}
}

func TestTossPlacePaymentWebhook_RecordsApprovalThenCancellation(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	seedBillWebhookOrder(t, "order-pay", "pos-pay", 20000, "DONE")

	approved := `{"id":"pay-1","orderId":"pos-pay","state":"APPROVED","sourceType":"ACCOUNT_TRANSFER","paymentMethod":"계좌이체","amount":20000,"taxAmount":1818,"supplyAmount":18182,"taxExemptAmount":0,"approvedNo":"","approvedAt":"2026-09-01T13:00:00Z"}`
	cancelled := `{"id":"pay-1","orderId":"pos-pay","state":"CANCELLED","sourceType":"ACCOUNT_TRANSFER","paymentMethod":"계좌이체","amount":20000,"taxAmount":1818,"supplyAmount":18182,"taxExemptAmount":0,"approvedNo":"","approvedAt":"2026-09-01T13:00:00Z","cancelledAt":"2026-09-01T13:10:00Z"}`

	for _, step := range []struct{ eventType, payment, want string }{
		{"payment.payment.approved.v1", approved, "APPROVED/ACCOUNT_TRANSFER/20000"},
		{"payment.payment.approved.v1", approved, "APPROVED/ACCOUNT_TRANSFER/20000"},
		{"payment.payment.cancelled.v1", cancelled, "CANCELLED/ACCOUNT_TRANSFER/20000"},
	} {
		rec := tossPlaceWebhookRequestTo(t, handler, "/api/v1/webhooks/tossplace/orders", tossPlaceWebhookSecret, paymentEventBody(t, step.eventType, step.payment), false)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, body = %s", step.eventType, rec.Code, rec.Body.String())
		}
		payments := billPayments(t, "pos-pay")
		if len(payments) != 1 || payments["pay-1"] != step.want {
			t.Fatalf("after %s payments = %v, want pay-1 %s", step.eventType, payments, step.want)
		}
	}
}

func TestTossPlacePaymentWebhook_RejectsInvalidSignature(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	body := paymentEventBody(t, "payment.payment.approved.v1", `{"id":"pay-x","orderId":"pos-x"}`)
	rec := tossPlaceWebhookRequestTo(t, handler, "/api/v1/webhooks/tossplace/orders", tossPlaceWebhookSecret, body, true)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// A bill whose payments could not be fetched when it completed is retried
// the next time any TossPlace webhook arrives.
func TestTossPlaceWebhook_RetriesPaymentSyncForPaidBillsMissingPayments(t *testing.T) {
	tossServer := mockTossPlaceServer(t, map[string]string{}, map[string]string{
		"pos-stale": `[{"id":"pay-stale","orderId":"pos-stale","state":"APPROVED","sourceType":"CARD","paymentMethod":"신용카드","amount":11000,"taxAmount":1000,"supplyAmount":10000,"taxExemptAmount":0,"approvedNo":"A9","approvedAt":"2026-09-01T12:00:00Z"}]`,
	})
	defer tossServer.Close()
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, tossServer.URL))
	seedBillWebhookOrder(t, "order-stale", "pos-stale", 11000, "DONE")
	if _, err := testPool.Exec(t.Context(), `
		UPDATE pos_bills SET status = 'PAID', total_amount = 11000, completed_at = NOW() - INTERVAL '1 hour', payment_sync_attempted_at = NOW() - INTERVAL '1 hour'
		WHERE pos_order_id = 'pos-stale'
	`); err != nil {
		t.Fatalf("age bill: %v", err)
	}

	unrelated := paymentEventBody(t, "payment.payment.approved.v1", `{"id":"pay-other","orderId":"pos-other","state":"APPROVED","sourceType":"CASH","paymentMethod":"현금","amount":1000,"taxAmount":91,"supplyAmount":909,"taxExemptAmount":0,"approvedNo":""}`)
	if rec := tossPlaceWebhookRequestTo(t, handler, "/api/v1/webhooks/tossplace/orders", tossPlaceWebhookSecret, unrelated, false); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	if payments := billPayments(t, "pos-stale"); payments["pay-stale"] != "APPROVED/CARD/11000" {
		t.Fatalf("payments = %v, want the retried sync to store pay-stale", payments)
	}
}

// Payment events share the order webhook's URL and signing secret: TossPlace
// lets one subscription carry both scopes but only one payload URL, and a
// second subscription would get its own secret this handler cannot verify.
func TestTossPlacePaymentWebhook_HasNoSeparatePaymentsPath(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	body := paymentEventBody(t, "payment.payment.approved.v1", `{"id":"pay-x","orderId":"pos-x"}`)
	rec := tossPlaceWebhookRequestTo(t, handler, "/api/v1/webhooks/tossplace/payments", tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
