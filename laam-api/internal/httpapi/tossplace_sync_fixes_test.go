package httpapi

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/store"
)

// fakeTossPlaceAPI is a mutable TossPlace Open API stub: orders and
// payments can be changed between deliveries, GetOrder can be made to fail,
// and orderBarrier holds every GetOrder response until that many requests
// have arrived (to line concurrent deliveries up).
type fakeTossPlaceAPI struct {
	mu           sync.Mutex
	orders       map[string]string // POS order id -> Order JSON (success value)
	payments     map[string]string // POS order id -> success value of by-order-id
	failOrders   bool
	orderBarrier int
	orderCalls   int
	released     chan struct{}
}

func newFakeTossPlaceAPI(t *testing.T) (*fakeTossPlaceAPI, *httptest.Server) {
	t.Helper()
	fake := &fakeTossPlaceAPI{orders: map[string]string{}, payments: map[string]string{}, released: make(chan struct{})}
	const prefix = "/api-public/openapi/v1/merchants/merchant-1"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == prefix+"/payment/payments/by-order-id":
			fake.mu.Lock()
			body, ok := fake.payments[r.URL.Query().Get("orderId")]
			fake.mu.Unlock()
			if ok {
				_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":` + body + `}`))
				return
			}
		case strings.HasPrefix(r.URL.Path, prefix+"/order/orders/"):
			fake.mu.Lock()
			fake.orderCalls++
			if fake.orderBarrier > 0 && fake.orderCalls == fake.orderBarrier {
				close(fake.released)
			}
			barrier := fake.orderBarrier
			fail := fake.failOrders
			body, ok := fake.orders[strings.TrimPrefix(r.URL.Path, prefix+"/order/orders/")]
			fake.mu.Unlock()
			if barrier > 0 {
				select {
				case <-fake.released:
				case <-time.After(5 * time.Second):
				}
			}
			if ok && !fail {
				_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":` + body + `}`))
				return
			}
		}
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"resultType":"FAILURE","error":{"errorCode":"NOT_FOUND","reason":"not found"}}`))
	}))
	t.Cleanup(server.Close)
	return fake, server
}

func (f *fakeTossPlaceAPI) set(posOrderID string, order string, payments string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.orders[posOrderID] = order
	f.payments[posOrderID] = payments
}

func (f *fakeTossPlaceAPI) setFailOrders(fail bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failOrders = fail
}

func billSyncRow(t *testing.T, posOrderID string) (status string, total *int64, synced bool) {
	t.Helper()
	if err := testPool.QueryRow(t.Context(), `
		SELECT status, total_amount, payments_synced_at IS NOT NULL FROM pos_bills WHERE pos_order_id = $1
	`, posOrderID).Scan(&status, &total, &synced); err != nil {
		t.Fatalf("query bill %q: %v", posOrderID, err)
	}
	return status, total, synced
}

func countNativeRows(t *testing.T, posOrderID string, menuItemName string) int {
	t.Helper()
	var count int
	if err := testPool.QueryRow(t.Context(), `
		SELECT COUNT(*) FROM payment_orders WHERE pos_order_id = $1 AND menu_item_name = $2
	`, posOrderID, menuItemName).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}

const (
	webLineJSON    = `{"item":{"title":"하우스 하이볼","category":{"title":"하이볼"}},"itemPrice":{"priceValue":11000},"quantity":1,"optionChoices":[]}`
	nativeLineJSON = `{"item":{"title":"생맥주","category":{"title":"맥주"}},"itemPrice":{"priceValue":6000},"quantity":1,"optionChoices":[]}`
)

func approvedPaymentJSON(id string, posOrderID string, amount int64) string {
	return `{"id":"` + id + `","orderId":"` + posOrderID + `","state":"APPROVED","sourceType":"CARD","paymentMethod":"신용카드","amount":` +
		strconv.FormatInt(amount, 10) + `,"taxAmount":0,"supplyAmount":0,"taxExemptAmount":0,"approvedNo":"","approvedAt":"2026-09-01T13:00:00Z"}`
}

// #2: order.cancelled refreshes the bill's payments so an APPROVED payment
// recorded earlier does not keep counting after the refund.
func TestTossPlaceWebhook_CancelledEventRefreshesPayments(t *testing.T) {
	fake, server := newFakeTossPlaceAPI(t)
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, server.URL))
	seedBillWebhookOrder(t, "order-refund", "pos-refund", 11000, "DONE")
	if err := testRepo.UpsertPOSPayments(t.Context(), "pos-refund", []store.POSPaymentInput{
		{ID: "pay-refund", State: "APPROVED", SourceType: "CARD", Amount: 11000, ApprovedAt: time.Date(2026, 9, 1, 13, 0, 0, 0, time.UTC)},
	}, true); err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	fake.set("pos-refund", `{"id":"pos-refund","orderState":"CANCELLED","lineItems":[]}`,
		`[{"id":"pay-refund","orderId":"pos-refund","state":"CANCELLED","sourceType":"CARD","paymentMethod":"신용카드","amount":11000,"taxAmount":0,"supplyAmount":0,"taxExemptAmount":0,"approvedNo":"","approvedAt":"2026-09-01T13:00:00Z","cancelledAt":"2026-09-01T13:30:00Z"}]`)

	if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, orderEventBody(t, "order.order.cancelled.v1", "pos-refund", "order-refund"), false); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	if payments := billPayments(t, "pos-refund"); payments["pay-refund"] != "CANCELLED/CARD/11000" {
		t.Fatalf("payments = %v, want pay-refund refreshed to CANCELLED", payments)
	}
}

// #3: a paid bill whose payment list does not add up to the POS charge is
// not marked payment-synced, so stats keep using menu amounts and the
// retry claim picks it up again.
func TestTossPlaceWebhook_CompletedEventLeavesBillUnsyncedWhenPaymentsDoNotCoverCharge(t *testing.T) {
	fake, server := newFakeTossPlaceAPI(t)
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, server.URL))
	seedBillWebhookOrder(t, "order-short", "pos-short", 11000, "READY")
	seedBillWebhookOrder(t, "order-empty", "pos-empty", 11000, "READY")
	fake.set("pos-short", `{"id":"pos-short","orderState":"COMPLETED","chargePrice":{"totalAmount":11000,"discountAmount":0},"lineItems":[`+webLineJSON+`]}`,
		`[`+approvedPaymentJSON("pay-short", "pos-short", 5000)+`]`)
	fake.set("pos-empty", `{"id":"pos-empty","orderState":"COMPLETED","chargePrice":{"totalAmount":11000,"discountAmount":0},"lineItems":[`+webLineJSON+`]}`, `[]`)

	for _, posOrderID := range []string{"pos-short", "pos-empty"} {
		orderKey := map[string]string{"pos-short": "order-short", "pos-empty": "order-empty"}[posOrderID]
		if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, orderEventBody(t, "order.order.completed.v1", posOrderID, orderKey), false); rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d", posOrderID, rec.Code)
		}
		if status, _, synced := billSyncRow(t, posOrderID); status != "PAID" || synced {
			t.Fatalf("%s bill = %s synced=%v, want PAID and not payment-synced", posOrderID, status, synced)
		}
	}
}

// #4: TossPlace is the source of truth for the order's state. A completed
// delivery for an order TossPlace now reports CANCELLED cancels the bill
// instead of completing it and recording POS-native lines.
func TestTossPlaceWebhook_CompletedEventForOrderReportedCancelledCancelsBill(t *testing.T) {
	fake, server := newFakeTossPlaceAPI(t)
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, server.URL))
	seedBillWebhookOrder(t, "order-void", "pos-void", 11000, "READY")
	fake.set("pos-void", `{"id":"pos-void","orderState":"CANCELLED","cancelledAt":"2026-09-01T13:30:00Z","chargePrice":{"totalAmount":17000,"discountAmount":0},"lineItems":[`+webLineJSON+`,`+nativeLineJSON+`]}`, `[]`)

	if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, orderEventBody(t, "order.order.completed.v1", "pos-void", "order-void"), false); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	if statuses := orderStatuses(t, "pos-void"); len(statuses) != 1 || statuses["order-void"] != "CANCELLED" {
		t.Fatalf("statuses = %v, want only order-void, CANCELLED", statuses)
	}
	if status, _, _ := billSyncRow(t, "pos-void"); status != "CANCELLED" {
		t.Fatalf("bill status = %q, want CANCELLED", status)
	}
}

// #4: a bill already cancelled gets no POS-native lines from a late
// completed delivery.
func TestTossPlaceWebhook_CompletedEventRecordsNoNativeLinesOnCancelledBill(t *testing.T) {
	fake, server := newFakeTossPlaceAPI(t)
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, server.URL))
	seedBillWebhookOrder(t, "order-gone", "pos-gone", 11000, "CANCELLED")
	if _, err := testPool.Exec(t.Context(), `UPDATE pos_bills SET status = 'CANCELLED', cancelled_at = NOW() WHERE pos_order_id = 'pos-gone'`); err != nil {
		t.Fatalf("cancel bill: %v", err)
	}
	fake.set("pos-gone", `{"id":"pos-gone","orderState":"COMPLETED","completedAt":"2026-09-01T13:00:00Z","chargePrice":{"totalAmount":17000,"discountAmount":0},"lineItems":[`+webLineJSON+`,`+nativeLineJSON+`]}`, `[]`)

	if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, orderEventBody(t, "order.order.completed.v1", "pos-gone", "order-gone"), false); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	if count := countNativeRows(t, "pos-gone", "생맥주"); count != 0 {
		t.Fatalf("native rows = %d, want none on a cancelled bill", count)
	}
}

// #5: duplicate completed deliveries processed at the same moment must
// record each POS-native line once.
func TestTossPlaceWebhook_ConcurrentCompletedDeliveriesRecordNativeLineOnce(t *testing.T) {
	const deliveries = 6
	fake, server := newFakeTossPlaceAPI(t)
	fake.orderBarrier = deliveries
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, server.URL))
	seedBillWebhookOrder(t, "order-web", "pos-race", 11000, "READY")
	fake.set("pos-race", `{"id":"pos-race","orderState":"COMPLETED","completedAt":"2026-09-01T13:00:00Z","chargePrice":{"totalAmount":17000,"discountAmount":0},"lineItems":[`+webLineJSON+`,`+nativeLineJSON+`]}`,
		`[`+approvedPaymentJSON("pay-race", "pos-race", 17000)+`]`)

	body := orderEventBody(t, "order.order.completed.v1", "pos-race", "order-web")
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	signature := signTossPlaceWebhook(t, tossPlaceWebhookSecret, timestamp, body)
	codes := make(chan int, deliveries)
	var wg sync.WaitGroup
	for i := 0; i < deliveries; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/tossplace/orders", bytes.NewReader(body))
			req.Header.Set("x-toss-signature", signature)
			req.Header.Set("x-toss-timestamp", timestamp)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			codes <- rec.Code
		}()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusOK {
			t.Fatalf("delivery status = %d", code)
		}
	}

	if count := countNativeRows(t, "pos-race", "생맥주"); count != 1 {
		t.Fatalf("native 생맥주 rows = %d, want exactly 1", count)
	}
}

// #9: when GetOrder fails while completing a bill with web orders, the
// POS-native lines and the charge are recovered by the retry that runs on
// a later webhook.
func TestTossPlaceWebhook_RetriesOrderRefreshWhenGetOrderFailedOnCompletion(t *testing.T) {
	fake, server := newFakeTossPlaceAPI(t)
	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, server.URL))
	seedBillWebhookOrder(t, "order-web", "pos-flaky", 11000, "READY")
	fake.set("pos-flaky", `{"id":"pos-flaky","orderState":"COMPLETED","completedAt":"2026-09-01T13:00:00Z","chargePrice":{"totalAmount":17000,"discountAmount":0},"lineItems":[`+webLineJSON+`,`+nativeLineJSON+`]}`,
		`[`+approvedPaymentJSON("pay-flaky", "pos-flaky", 17000)+`]`)
	fake.setFailOrders(true)

	if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, orderEventBody(t, "order.order.completed.v1", "pos-flaky", "order-web"), false); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if status, _, synced := billSyncRow(t, "pos-flaky"); status != "PAID" || synced {
		t.Fatalf("bill = %s synced=%v, want PAID and left unsynced for the retry", status, synced)
	}

	fake.setFailOrders(false)
	if _, err := testPool.Exec(t.Context(), `UPDATE pos_bills SET payment_sync_attempted_at = NOW() - INTERVAL '1 hour' WHERE pos_order_id = 'pos-flaky'`); err != nil {
		t.Fatalf("age attempt: %v", err)
	}
	unrelated := paymentEventBody(t, "payment.payment.approved.v1", `{"id":"pay-other","orderId":"pos-other","state":"APPROVED","sourceType":"CASH","paymentMethod":"현금","amount":1000,"taxAmount":91,"supplyAmount":909,"taxExemptAmount":0,"approvedNo":""}`)
	if rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, unrelated, false); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	if count := countNativeRows(t, "pos-flaky", "생맥주"); count != 1 {
		t.Fatalf("native 생맥주 rows = %d, want 1 after the retry", count)
	}
	status, total, synced := billSyncRow(t, "pos-flaky")
	if status != "PAID" || total == nil || *total != 17000 || !synced {
		t.Fatalf("bill = %s total=%v synced=%v, want PAID/17000/synced after the retry", status, total, synced)
	}
}

// #10: a correctly signed but stale (or far-future) delivery is a replay
// and is rejected. x-toss-timestamp is epoch milliseconds.
func TestTossPlaceWebhook_RejectsTimestampOutsideFreshnessWindow(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	body := []byte(`{"id":"evt-replay","type":"order.order.unknown.v1","data":{}}`)
	for name, offset := range map[string]time.Duration{"stale": -10 * time.Minute, "future": 10 * time.Minute} {
		timestamp := strconv.FormatInt(time.Now().Add(offset).UnixMilli(), 10)
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/webhooks/tossplace/orders", body, map[string]string{
			"x-toss-signature": signTossPlaceWebhook(t, tossPlaceWebhookSecret, timestamp, body),
			"x-toss-timestamp": timestamp,
		})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s timestamp: status = %d, want 401", name, rec.Code)
		}
	}

	timestamp := strconv.FormatInt(time.Now().Add(-2*time.Minute).UnixMilli(), 10)
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/webhooks/tossplace/orders", body, map[string]string{
		"x-toss-signature": signTossPlaceWebhook(t, tossPlaceWebhookSecret, timestamp, body),
		"x-toss-timestamp": timestamp,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("fresh timestamp: status = %d, want 200", rec.Code)
	}
}
