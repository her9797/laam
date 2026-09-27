package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
)

const tossPlaceWebhookSecret = "test-webhook-secret"

func signTossPlaceWebhook(t *testing.T, secret string, timestamp string, body []byte) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}

func tossPlaceWebhookRequest(t *testing.T, handler http.Handler, secret string, body []byte, corrupt bool) *httptest.ResponseRecorder {
	t.Helper()
	return tossPlaceWebhookRequestTo(t, handler, "/api/v1/webhooks/tossplace/orders", secret, body, corrupt)
}

func tossPlaceWebhookRequestTo(t *testing.T, handler http.Handler, path string, secret string, body []byte, corrupt bool) *httptest.ResponseRecorder {
	t.Helper()
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	signature := signTossPlaceWebhook(t, secret, timestamp, body)
	if corrupt {
		signature = "v1=0000000000000000000000000000000000000000000000000000000000000000"
	}
	headers := map[string]string{
		"x-toss-signature":   signature,
		"x-toss-timestamp":   timestamp,
		"x-toss-webhook-id":  "wh_test",
		"x-toss-delivery-id": "dv_test",
		"x-toss-event-id":    "ev_test",
	}
	return doRequest(t, handler, http.MethodPost, path, body, headers)
}

func webhookTestCfg() config.Config {
	cfg := testCfg
	cfg.TossPlaceWebhookSecret = tossPlaceWebhookSecret
	return cfg
}

func seedWebhookPaymentOrder(t *testing.T, orderID string, status string) {
	t.Helper()
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO menu_categories (id, label, sort_order) VALUES ('highball', '하이볼', 1)
		ON CONFLICT (id) DO NOTHING;
		INSERT INTO menu_items (id, category_id, name, description, price, sort_order, toss_catalog_item_id)
		VALUES ('house-highball', 'highball', '하우스 하이볼', '테스트 메뉴', '11,000원', 1, 'pos-item-1')
		ON CONFLICT (id) DO NOTHING;
	`); err != nil {
		t.Fatalf("seed menu: %v", err)
	}
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO payment_orders (id, menu_item_id, menu_item_name, category_name, table_number, amount, status, pos_sync_status)
		VALUES ($1, 'house-highball', '하우스 하이볼', '하이볼', '7', 11000, $2, 'SUCCEEDED')
	`, orderID, status); err != nil {
		t.Fatalf("seed payment order: %v", err)
	}
}

func TestTossPlaceWebhook_RejectsMissingSignature(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	body, _ := json.Marshal(map[string]any{"type": "order.order.completed.v1"})
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/webhooks/tossplace/orders", body, map[string]string{
		"x-toss-timestamp": "1700000000000",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestTossPlaceWebhook_RejectsInvalidSignature(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	body, _ := json.Marshal(map[string]any{"type": "order.order.completed.v1"})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, true)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestTossPlaceWebhook_IgnoresUnknownEventTypeButAcks200(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	body, _ := json.Marshal(map[string]any{
		"id":        "evt-1",
		"type":      "order.order.created.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data":      map[string]any{"orderKey": "does-not-exist"},
	})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestTossPlaceWebhook_CompletedEventMarksOrderDone(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	seedWebhookPaymentOrder(t, "order-wh-1", "READY")

	body, _ := json.Marshal(map[string]any{
		"id":        "evt-2",
		"type":      "order.order.completed.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "order-wh-1",
			"orderKey":    "order-wh-1",
			"orderNumber": "N-1",
			"source":      "POS",
			"completedAt": "2026-01-10T12:05:00.000Z",
		},
	})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	order, err := testRepo.GetPaymentOrder(t.Context(), "order-wh-1")
	if err != nil {
		t.Fatalf("GetPaymentOrder() error = %v", err)
	}
	if order.Status != "DONE" {
		t.Fatalf("Status = %q, want DONE", order.Status)
	}
	if order.PaymentMethod != "POS" {
		t.Fatalf("PaymentMethod = %q, want POS", order.PaymentMethod)
	}
	wantVAT := int64(1000)
	wantSupplied := int64(10000)
	if order.VAT != wantVAT || order.SuppliedAmount != wantSupplied {
		t.Fatalf("vat=%d supplied=%d, want vat=%d supplied=%d", order.VAT, order.SuppliedAmount, wantVAT, wantSupplied)
	}
}

func TestTossPlaceWebhook_CompletedEventIsIdempotentOnRetry(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	seedWebhookPaymentOrder(t, "order-wh-2", "READY")

	body, _ := json.Marshal(map[string]any{
		"id":        "evt-3",
		"type":      "order.order.completed.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "order-wh-2",
			"orderKey":    "order-wh-2",
			"orderNumber": "N-2",
			"source":      "POS",
			"completedAt": "2026-01-10T12:05:00.000Z",
		},
	})

	first := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if first.Code != http.StatusOK {
		t.Fatalf("first delivery status = %d", first.Code)
	}
	second := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if second.Code != http.StatusOK {
		t.Fatalf("retry delivery status = %d, want 200", second.Code)
	}

	order, err := testRepo.GetPaymentOrder(t.Context(), "order-wh-2")
	if err != nil {
		t.Fatalf("GetPaymentOrder() error = %v", err)
	}
	if order.Status != "DONE" {
		t.Fatalf("Status = %q, want DONE", order.Status)
	}
}

func TestTossPlaceWebhook_CompletedEventForUnknownOrderKeyStillAcks200(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	body, _ := json.Marshal(map[string]any{
		"id":        "evt-4",
		"type":      "order.order.completed.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "missing-order",
			"orderKey":    "missing-order",
			"orderNumber": "N-4",
			"source":      "POS",
			"completedAt": "2026-01-10T12:05:00.000Z",
		},
	})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (ack, no retry storm)", rec.Code)
	}
}

func TestTossPlaceWebhook_CompletedEventOnCancelledOrderDoesNotOverwriteButStillAcks200(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	seedWebhookPaymentOrder(t, "order-wh-5", "CANCELLED")

	body, _ := json.Marshal(map[string]any{
		"id":        "evt-5",
		"type":      "order.order.completed.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "order-wh-5",
			"orderKey":    "order-wh-5",
			"orderNumber": "N-5",
			"source":      "POS",
			"completedAt": "2026-01-10T12:05:00.000Z",
		},
	})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	order, err := testRepo.GetPaymentOrder(t.Context(), "order-wh-5")
	if err != nil {
		t.Fatalf("GetPaymentOrder() error = %v", err)
	}
	if order.Status != "CANCELLED" {
		t.Fatalf("Status = %q, want CANCELLED (must not be overwritten to DONE)", order.Status)
	}
}

// mockTossPlaceOrderServer serves a single GetOrder response for orderID
// (and an empty payment list for it), asserting the request path/auth
// headers match what tossplace.Client sends.
func mockTossPlaceOrderServer(t *testing.T, orderID string, responseBody string) *httptest.Server {
	t.Helper()
	return mockTossPlaceServer(t, map[string]string{orderID: responseBody}, map[string]string{orderID: `[]`})
}

// mockTossPlaceServer serves GetOrder responses (orders, keyed by POS order
// id, each a full success object) and GetPaymentsByOrderID responses
// (payments, keyed by POS order id, each a JSON array). Anything else is a
// 404 and a test error.
func mockTossPlaceServer(t *testing.T, orders map[string]string, payments map[string]string) *httptest.Server {
	t.Helper()
	const prefix = "/api-public/openapi/v1/merchants/merchant-1"
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-access-key") != "test-access" || r.Header.Get("x-secret-key") != "test-secret" {
			t.Error("missing TossPlace authentication headers")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet && r.URL.Path == prefix+"/payment/payments/by-order-id" {
			if body, ok := payments[r.URL.Query().Get("orderId")]; ok {
				_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":` + body + `}`))
				return
			}
		}
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, prefix+"/order/orders/") {
			if body, ok := orders[strings.TrimPrefix(r.URL.Path, prefix+"/order/orders/")]; ok {
				_, _ = w.Write([]byte(body))
				return
			}
		}
		t.Errorf("unexpected TossPlace request %s %s", r.Method, r.URL.String())
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"resultType":"FAILURE","error":{"errorCode":"NOT_FOUND"}}`))
	}))
}

func posNativeWebhookTestCfg(t *testing.T, tossServerURL string) config.Config {
	cfg := webhookTestCfg()
	cfg.TossPlaceAPIBaseURL = tossServerURL
	cfg.TossPlaceAccessKey = "test-access"
	cfg.TossPlaceSecretKey = "test-secret"
	cfg.TossPlaceMerchantID = "merchant-1"
	return cfg
}

func countPaymentOrdersByPOSOrderID(t *testing.T, posOrderID string) int {
	t.Helper()
	var count int
	if err := testPool.QueryRow(t.Context(), `SELECT COUNT(*) FROM payment_orders WHERE pos_order_id = $1`, posOrderID).Scan(&count); err != nil {
		t.Fatalf("count payment_orders: %v", err)
	}
	return count
}

func TestTossPlaceWebhook_CompletedEventForUnknownOrderKeyCreatesPOSNativeOrder(t *testing.T) {
	tossServer := mockTossPlaceOrderServer(t, "pos-order-99", `{
		"resultType": "SUCCESS",
		"success": {
			"id": "pos-order-99",
			"source": "POS",
			"orderState": "COMPLETED",
			"completedAt": "2026-01-10T12:05:00.000Z",
			"lineItems": [
				{
					"item": {"title": "생맥주", "category": {"title": "맥주"}},
					"itemPrice": {"priceValue": 6000},
					"quantity": 2,
					"optionChoices": []
				}
			]
		}
	}`)
	defer tossServer.Close()

	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, tossServer.URL))

	body, _ := json.Marshal(map[string]any{
		"id":        "evt-9",
		"type":      "order.order.completed.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "pos-order-99",
			"orderKey":    "toss-native-key-1",
			"orderNumber": "N-9",
			"source":      "POS",
			"completedAt": "2026-01-10T12:05:00.000Z",
		},
	})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var menuItemName, categoryName, status string
	var amount int64
	if err := testPool.QueryRow(t.Context(), `
		SELECT menu_item_name, category_name, amount, status
		FROM payment_orders WHERE pos_order_id = $1
	`, "pos-order-99").Scan(&menuItemName, &categoryName, &amount, &status); err != nil {
		t.Fatalf("query created order: %v", err)
	}
	if menuItemName != "생맥주" || categoryName != "맥주" || amount != 12000 || status != "DONE" {
		t.Fatalf("menuItemName=%q categoryName=%q amount=%d status=%q, want 생맥주/맥주/12000/DONE",
			menuItemName, categoryName, amount, status)
	}
}

func TestTossPlaceWebhook_CompletedEventForUnknownOrderKeyIsIdempotentOnRetry(t *testing.T) {
	tossServer := mockTossPlaceOrderServer(t, "pos-order-100", `{
		"resultType": "SUCCESS",
		"success": {
			"id": "pos-order-100",
			"source": "POS",
			"completedAt": "2026-01-10T12:05:00.000Z",
			"lineItems": [
				{
					"item": {"title": "생맥주", "category": {"title": "맥주"}},
					"itemPrice": {"priceValue": 6000},
					"quantity": 1,
					"optionChoices": []
				}
			]
		}
	}`)
	defer tossServer.Close()

	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, tossServer.URL))

	body, _ := json.Marshal(map[string]any{
		"id":        "evt-10",
		"type":      "order.order.completed.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "pos-order-100",
			"orderKey":    "toss-native-key-2",
			"orderNumber": "N-10",
			"source":      "POS",
			"completedAt": "2026-01-10T12:05:00.000Z",
		},
	})

	first := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if first.Code != http.StatusOK {
		t.Fatalf("first delivery status = %d", first.Code)
	}
	second := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if second.Code != http.StatusOK {
		t.Fatalf("retry delivery status = %d, want 200", second.Code)
	}

	if got := countPaymentOrdersByPOSOrderID(t, "pos-order-100"); got != 1 {
		t.Fatalf("payment_orders rows for pos-order-100 = %d, want 1 (retry must not duplicate)", got)
	}
}

func TestTossPlaceWebhook_CancelledEventMarksOrderCancelled(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	seedWebhookPaymentOrder(t, "order-wh-6", "READY")

	body, _ := json.Marshal(map[string]any{
		"id":        "evt-6",
		"type":      "order.order.cancelled.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "order-wh-6",
			"orderKey":    "order-wh-6",
			"orderNumber": "N-6",
			"source":      "POS",
			"cancelledAt": "2026-01-10T12:05:00.000Z",
		},
	})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	order, err := testRepo.GetPaymentOrder(t.Context(), "order-wh-6")
	if err != nil {
		t.Fatalf("GetPaymentOrder() error = %v", err)
	}
	if order.Status != "CANCELLED" {
		t.Fatalf("Status = %q, want CANCELLED", order.Status)
	}
}

func TestTossPlaceWebhook_CancelledEventForUnknownOrderKeyStillAcks200(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	body, _ := json.Marshal(map[string]any{
		"id":        "evt-7",
		"type":      "order.order.cancelled.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "missing-order",
			"orderKey":    "missing-order",
			"orderNumber": "N-7",
			"source":      "POS",
			"cancelledAt": "2026-01-10T12:05:00.000Z",
		},
	})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (ack, no retry storm)", rec.Code)
	}
}

func TestTossPlaceWebhook_RejectsMalformedBody(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	body := []byte("{not json")
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestTossPlaceWebhook_AcceptsTimestampWithoutTimezone(t *testing.T) {
	handler := resetServerWithConfig(t, webhookTestCfg())
	seedWebhookPaymentOrder(t, "order-wh-8", "READY")

	body, _ := json.Marshal(map[string]any{
		"id":        "evt-8",
		"type":      "order.order.completed.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "order-wh-8",
			"orderKey":    "order-wh-8",
			"orderNumber": "N-8",
			"source":      "POS",
			"completedAt": "2025-09-01T00:00:00",
		},
	})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	order, err := testRepo.GetPaymentOrder(t.Context(), "order-wh-8")
	if err != nil {
		t.Fatalf("GetPaymentOrder() error = %v", err)
	}
	if order.Status != "DONE" {
		t.Fatalf("Status = %q, want DONE", order.Status)
	}
}

// A POS-native order's created_at must come from TossPlace's openedAt (the
// moment the POS opened the order), not from when this webhook arrived —
// the admin order screens read created_at as the order time.
func TestTossPlaceWebhook_POSNativeOrderUsesOpenedAtAsCreatedAt(t *testing.T) {
	tossServer := mockTossPlaceOrderServer(t, "pos-order-100", `{
		"resultType": "SUCCESS",
		"success": {
			"id": "pos-order-100",
			"source": "POS",
			"orderState": "COMPLETED",
			"openedAt": "2026-01-10T11:40:00.000Z",
			"completedAt": "2026-01-10T12:05:00.000Z",
			"lineItems": [
				{
					"item": {"title": "생맥주", "category": {"title": "맥주"}},
					"itemPrice": {"priceValue": 6000},
					"quantity": 1,
					"optionChoices": []
				}
			]
		}
	}`)
	defer tossServer.Close()

	handler := resetServerWithConfig(t, posNativeWebhookTestCfg(t, tossServer.URL))

	body, _ := json.Marshal(map[string]any{
		"id":        "evt-10",
		"type":      "order.order.completed.v1",
		"createdAt": "2026-01-10T12:00:00.000Z",
		"data": map[string]any{
			"orderId":     "pos-order-100",
			"orderKey":    "toss-native-key-2",
			"orderNumber": "N-10",
			"source":      "POS",
			"completedAt": "2026-01-10T12:05:00.000Z",
		},
	})
	rec := tossPlaceWebhookRequest(t, handler, tossPlaceWebhookSecret, body, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var createdAt, approvedAt time.Time
	if err := testPool.QueryRow(t.Context(), `
		SELECT created_at, approved_at FROM payment_orders WHERE pos_order_id = $1
	`, "pos-order-100").Scan(&createdAt, &approvedAt); err != nil {
		t.Fatalf("query created order: %v", err)
	}
	wantCreated := time.Date(2026, 1, 10, 11, 40, 0, 0, time.UTC)
	wantApproved := time.Date(2026, 1, 10, 12, 5, 0, 0, time.UTC)
	if !createdAt.UTC().Equal(wantCreated) {
		t.Fatalf("created_at = %s, want %s (openedAt)", createdAt.UTC(), wantCreated)
	}
	if !approvedAt.UTC().Equal(wantApproved) {
		t.Fatalf("approved_at = %s, want %s (completedAt)", approvedAt.UTC(), wantApproved)
	}
}
