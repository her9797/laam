package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/her9797/lam/lam-api/internal/config"
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
	return doRequest(t, handler, http.MethodPost, "/api/v1/webhooks/tossplace/orders", body, headers)
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
