package httpapi

import (
	"net/http"
	"testing"
)

// TossPlace's "한 번에 결제" moves line items between POS orders at payment
// time. Production case: web order 제임슨 (10,000) was on POS order X; staff
// paid 조니워커 블랙 (11,000, rung on the POS) together with 제임슨 on POS
// order Y, and X was then paid with only 고독 (15,000) on it. Line items
// carry no reference to the order they came from, and the two completed
// events can arrive in either order.

const (
	movedJamesonLineJSON = `{"item":{"title":"제임슨","category":{"title":"위스키"}},"itemPrice":{"priceValue":10000},"quantity":1,"optionChoices":[{"title":"니트","priceValue":0,"quantity":1}]}`
	movedJohnnieLineJSON = `{"item":{"title":"조니워커 블랙","category":{"title":"위스키"}},"itemPrice":{"priceValue":11000},"quantity":1,"optionChoices":[]}`
	movedGodokLineJSON   = `{"item":{"title":"고독","category":{"title":"기타"}},"itemPrice":{"priceValue":15000},"quantity":1,"optionChoices":[]}`

	movedOrderXJSON = `{"id":"pos-x","orderState":"COMPLETED","completedAt":"2026-09-01T13:00:00Z","chargePrice":{"totalAmount":15000,"discountAmount":0},"lineItems":[` + movedGodokLineJSON + `]}`
	movedOrderYJSON = `{"id":"pos-y","orderState":"COMPLETED","completedAt":"2026-09-01T13:00:00Z","chargePrice":{"totalAmount":21000,"discountAmount":0},"lineItems":[` + movedJohnnieLineJSON + `,` + movedJamesonLineJSON + `]}`
)

func seedMovedJameson(t *testing.T) {
	t.Helper()
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO payment_orders (id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, pos_order_id, created_at)
		VALUES ('order-jameson', '제임슨', '위스키', 'N-01', 10000, 'READY', 'SUCCEEDED', 'pos-x', '2026-09-01T12:00:00Z')
	`); err != nil {
		t.Fatalf("seed 제임슨: %v", err)
	}
	if _, err := testRepo.EnsurePOSBill(t.Context(), "pos-x"); err != nil {
		t.Fatalf("EnsurePOSBill: %v", err)
	}
}

func setMovedOrderX(fake *fakeTossPlaceAPI) {
	fake.set("pos-x", movedOrderXJSON, `[{"id":"pay-x","orderId":"pos-x","state":"APPROVED","sourceType":"ACCOUNT_TRANSFER","paymentMethod":"계좌이체","amount":15000,"taxAmount":0,"supplyAmount":0,"taxExemptAmount":0,"approvedNo":"","approvedAt":"2026-09-01T13:00:00Z"}]`)
}

func setMovedOrderY(fake *fakeTossPlaceAPI) {
	fake.set("pos-y", movedOrderYJSON, `[`+approvedPaymentJSON("pay-y", "pos-y", 21000)+`]`)
}

func completeMoved(t *testing.T, handler http.Handler, posOrderID string, orderKey string) {
	t.Helper()
	if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, orderEventBody(t, "order.order.completed.v1", posOrderID, orderKey), false); rec.Code != http.StatusOK {
		t.Fatalf("completed %s status = %d", posOrderID, rec.Code)
	}
}

type movedRow struct {
	ID, Status, POSOrderID, Origin, BillOf string
	Amount                                 int64
}

func movedRowsNamed(t *testing.T, name string) []movedRow {
	t.Helper()
	rows, err := testPool.Query(t.Context(), `
		SELECT o.id, o.status, COALESCE(o.pos_order_id, ''), COALESCE(o.pos_origin_order_id, ''), COALESCE(b.pos_order_id, ''), o.amount
		FROM payment_orders o LEFT JOIN pos_bills b ON b.id = o.bill_id
		WHERE o.menu_item_name = $1
		ORDER BY o.id
	`, name)
	if err != nil {
		t.Fatalf("query %s rows: %v", name, err)
	}
	defer rows.Close()
	var out []movedRow
	for rows.Next() {
		var row movedRow
		if err := rows.Scan(&row.ID, &row.Status, &row.POSOrderID, &row.Origin, &row.BillOf, &row.Amount); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, row)
	}
	return out
}

// assertMovedJamesonSettled checks the end state both completion orders
// must reach.
func assertMovedJamesonSettled(t *testing.T) {
	t.Helper()
	jameson := movedRowsNamed(t, "제임슨")
	if len(jameson) != 1 {
		t.Fatalf("제임슨 rows = %+v, want exactly the web row", jameson)
	}
	if got := jameson[0]; got.ID != "order-jameson" || got.Status != "DONE" || got.POSOrderID != "pos-y" || got.Origin != "pos-x" || got.BillOf != "pos-y" {
		t.Fatalf("제임슨 = %+v, want the web row DONE on pos-y (origin pos-x) in Y's bill", got)
	}
	if johnnie := movedRowsNamed(t, "조니워커 블랙"); len(johnnie) != 1 || johnnie[0].Status != "DONE" || johnnie[0].POSOrderID != "pos-y" || johnnie[0].BillOf != "pos-y" || johnnie[0].Origin != "" {
		t.Fatalf("조니워커 블랙 = %+v, want one POS-native DONE row on Y", johnnie)
	}
	if godok := movedRowsNamed(t, "고독"); len(godok) != 1 || godok[0].Status != "DONE" || godok[0].POSOrderID != "pos-x" || godok[0].BillOf != "pos-x" {
		t.Fatalf("고독 = %+v, want one POS-native DONE row on X", godok)
	}
	var ready int
	if err := testPool.QueryRow(t.Context(), `SELECT COUNT(*) FROM payment_orders WHERE status IN ('READY', 'ACKNOWLEDGED')`).Scan(&ready); err != nil {
		t.Fatalf("count unpaid rows: %v", err)
	}
	if ready != 0 {
		t.Fatalf("unpaid rows = %d, want none left READY", ready)
	}
	for posOrderID, want := range map[string]int64{"pos-x": 15000, "pos-y": 21000} {
		status, total, synced := billSyncRow(t, posOrderID)
		if status != "PAID" || total == nil || *total != want || !synced {
			t.Fatalf("%s bill = %s total=%v synced=%v, want PAID/%d/synced", posOrderID, status, total, synced, want)
		}
		var rowsSum, paid int64
		if err := testPool.QueryRow(t.Context(), `
			SELECT
				COALESCE((SELECT SUM(o.amount) FROM payment_orders o WHERE o.bill_id = b.id AND o.status = 'DONE'), 0),
				COALESCE((SELECT SUM(p.amount) FROM pos_payments p WHERE p.bill_id = b.id AND p.state = 'APPROVED'), 0)
			FROM pos_bills b WHERE b.pos_order_id = $1
		`, posOrderID).Scan(&rowsSum, &paid); err != nil {
			t.Fatalf("revenue of %s: %v", posOrderID, err)
		}
		if rowsSum != want || paid != want {
			t.Fatalf("%s revenue: rows %d payments %d, want both %d", posOrderID, rowsSum, paid, want)
		}
	}
}

func TestTossPlaceWebhook_MovedItemSettlesOnPayingOrderWhenItCompletesFirst(t *testing.T) {
	fake, server := newFakeTossPlaceAPI(t)
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, server.URL))
	seedMovedJameson(t)
	setMovedOrderX(fake)
	setMovedOrderY(fake)

	completeMoved(t, handler, "pos-y", "toss-key-y")
	completeMoved(t, handler, "pos-x", "order-jameson")
	assertMovedJamesonSettled(t)

	// Re-delivered webhooks change nothing.
	completeMoved(t, handler, "pos-y", "toss-key-y")
	completeMoved(t, handler, "pos-x", "order-jameson")
	assertMovedJamesonSettled(t)
}

func TestTossPlaceWebhook_MovedItemSettlesOnPayingOrderWhenOriginCompletesFirst(t *testing.T) {
	fake, server := newFakeTossPlaceAPI(t)
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, server.URL))
	seedMovedJameson(t)
	setMovedOrderX(fake)
	setMovedOrderY(fake)

	completeMoved(t, handler, "pos-x", "order-jameson")
	completeMoved(t, handler, "pos-y", "toss-key-y")
	assertMovedJamesonSettled(t)

	completeMoved(t, handler, "pos-x", "order-jameson")
	completeMoved(t, handler, "pos-y", "toss-key-y")
	assertMovedJamesonSettled(t)
}

// When Y completes but X cannot be fetched to tell whether 제임슨 left it,
// nothing is guessed: Y's completion is left for the retry claim, which
// re-runs it in full once X can be fetched.
func TestTossPlaceWebhook_MovedItemCompletionIsRetriedAfterOriginLookupFailure(t *testing.T) {
	fake, server := newFakeTossPlaceAPI(t)
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, server.URL))
	seedMovedJameson(t)
	setMovedOrderY(fake) // X is unknown to TossPlace for now: its GET fails.

	completeMoved(t, handler, "pos-y", "toss-key-y")

	if jameson := movedRowsNamed(t, "제임슨"); len(jameson) != 1 || jameson[0].Status != "READY" || jameson[0].POSOrderID != "pos-x" {
		t.Fatalf("제임슨 = %+v, want the web row untouched while X cannot be fetched", jameson)
	}
	if johnnie := movedRowsNamed(t, "조니워커 블랙"); len(johnnie) != 0 {
		t.Fatalf("조니워커 블랙 = %+v, want nothing recorded before the completion can be planned", johnnie)
	}
	if status, total, synced := billSyncRow(t, "pos-y"); status != "PAID" || total != nil || synced {
		t.Fatalf("pos-y bill = %s total=%v synced=%v, want PAID with the charge unset and unsynced (left for retry)", status, total, synced)
	}

	setMovedOrderX(fake)
	if _, err := testPool.Exec(t.Context(), `UPDATE pos_bills SET payment_sync_attempted_at = NOW() - INTERVAL '1 hour' WHERE pos_order_id = 'pos-y'`); err != nil {
		t.Fatalf("age attempt: %v", err)
	}
	unrelated := paymentEventBody(t, "payment.payment.approved.v1", `{"id":"pay-other","orderId":"pos-other","state":"APPROVED","sourceType":"CASH","paymentMethod":"현금","amount":1000,"taxAmount":91,"supplyAmount":909,"taxExemptAmount":0,"approvedNo":""}`)
	if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, unrelated, false); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if jameson := movedRowsNamed(t, "제임슨"); len(jameson) != 1 || jameson[0].Status != "DONE" || jameson[0].POSOrderID != "pos-y" {
		t.Fatalf("제임슨 after retry = %+v, want adopted by pos-y", jameson)
	}
	completeMoved(t, handler, "pos-x", "order-jameson")
	assertMovedJamesonSettled(t)
}
