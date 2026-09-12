package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestRouter_AdminPaymentOrderStatus_RequiresAdminAuth(t *testing.T) {
	handler := resetServer(t)

	body := bytes.NewBufferString(`{"status":"ACKNOWLEDGED"}`).Bytes()
	rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/payment-orders/order-1/status", body, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrderStatus_AcknowledgesReadyOrder(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentOrderViaSQL(t, "order-1", "T-01", "READY", "NOT_CONFIGURED", 8000, base)

	body := bytes.NewBufferString(`{"status":"ACKNOWLEDGED"}`).Bytes()
	rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/payment-orders/order-1/status", body, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var order struct {
		OrderID string `json:"orderId"`
		Status  string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &order); err != nil {
		t.Fatalf("decode order: %v (body = %s)", err, rec.Body.String())
	}
	if order.OrderID != "order-1" || order.Status != "ACKNOWLEDGED" {
		t.Fatalf("order = %+v, want order-1/ACKNOWLEDGED", order)
	}
}

func TestRouter_AdminPaymentOrderStatus_RejectsNonAcknowledgedTargetStatus(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentOrderViaSQL(t, "order-1", "T-01", "READY", "NOT_CONFIGURED", 8000, base)

	for _, status := range []string{"DONE", "CANCELLED", "READY"} {
		body := bytes.NewBufferString(`{"status":"` + status + `"}`).Bytes()
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/payment-orders/order-1/status", body, adminHeaders())
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status(%q) = %d, want %d, body = %s", status, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
	}
}

func TestRouter_AdminPaymentOrderStatus_UnknownOrderReturnsNotFound(t *testing.T) {
	handler := resetServer(t)

	body := bytes.NewBufferString(`{"status":"ACKNOWLEDGED"}`).Bytes()
	rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/payment-orders/does-not-exist/status", body, adminHeaders())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}
