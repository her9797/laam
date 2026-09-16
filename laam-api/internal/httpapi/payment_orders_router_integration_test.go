package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func seedPaymentOrderViaSQL(t *testing.T, id string, tableNumber string, status string, posSyncStatus string, amount int64, createdAt time.Time) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, created_at
		) VALUES ($1, 'Beer', 'Drinks', $2, $3, $4, $5, $6)
	`, id, tableNumber, amount, status, posSyncStatus, createdAt)
	if err != nil {
		t.Fatalf("seed payment_orders %q: %v", id, err)
	}
}

func TestRouter_AdminPaymentOrders_RequiresAdminAuth(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders", nil, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrders_RejectsNonGet(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/payment-orders", nil, adminHeaders())
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusMethodNotAllowed, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrders_ReturnsEnvelope(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentOrderViaSQL(t, "order-1", "T-01", "DONE", "SUCCEEDED", 8000, base)
	seedPaymentOrderViaSQL(t, "order-2", "T-02", "READY", "PENDING", 5000, base.Add(time.Hour))

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope struct {
		Items []struct {
			OrderID     string `json:"orderId"`
			TableNumber string `json:"tableNumber"`
			Amount      int64  `json:"amount"`
			Status      string `json:"status"`
		} `json:"items"`
		Page     int `json:"page"`
		PageSize int `json:"pageSize"`
		Total    int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v (body = %s)", err, rec.Body.String())
	}
	if envelope.Total != 2 || len(envelope.Items) != 2 || envelope.Page != 1 || envelope.PageSize != 20 {
		t.Fatalf("envelope = %+v, want total=2 items=2 page=1 pageSize=20", envelope)
	}
}

func TestRouter_AdminPaymentOrders_FiltersByStatus(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentOrderViaSQL(t, "order-1", "T-01", "DONE", "SUCCEEDED", 8000, base)
	seedPaymentOrderViaSQL(t, "order-2", "T-02", "READY", "PENDING", 5000, base.Add(time.Hour))

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders?status=DONE", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope struct {
		Items []struct {
			OrderID string `json:"orderId"`
		} `json:"items"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v (body = %s)", err, rec.Body.String())
	}
	if envelope.Total != 1 || len(envelope.Items) != 1 || envelope.Items[0].OrderID != "order-1" {
		t.Fatalf("envelope = %+v, want a single order-1 match", envelope)
	}
}

func TestRouter_AdminPaymentOrders_FiltersByAcknowledgedStatus(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentOrderViaSQL(t, "order-1", "T-01", "ACKNOWLEDGED", "NOT_CONFIGURED", 8000, base)
	seedPaymentOrderViaSQL(t, "order-2", "T-02", "READY", "PENDING", 5000, base.Add(time.Hour))

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders?status=ACKNOWLEDGED", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope struct {
		Items []struct {
			OrderID string `json:"orderId"`
		} `json:"items"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v (body = %s)", err, rec.Body.String())
	}
	if envelope.Total != 1 || len(envelope.Items) != 1 || envelope.Items[0].OrderID != "order-1" {
		t.Fatalf("envelope = %+v, want a single order-1 match", envelope)
	}
}

func TestRouter_AdminPaymentOrders_InvalidParamIsBadRequest(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders?sort=tableNumber", nil, adminHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrderDetail_RequiresAdminAuth(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders/order-1", nil, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrderDetail_RejectsNonGet(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/payment-orders/order-1", nil, adminHeaders())
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusMethodNotAllowed, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrderDetail_ReturnsOrder(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentOrderViaSQL(t, "order-1", "T-01", "DONE", "SUCCEEDED", 8000, base)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders/order-1", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var order struct {
		OrderID     string `json:"orderId"`
		TableNumber string `json:"tableNumber"`
		Amount      int64  `json:"amount"`
		Status      string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &order); err != nil {
		t.Fatalf("decode order: %v (body = %s)", err, rec.Body.String())
	}
	if order.OrderID != "order-1" || order.TableNumber != "T-01" || order.Amount != 8000 || order.Status != "DONE" {
		t.Fatalf("order = %+v, want order-1/T-01/8000/DONE", order)
	}
}

func TestRouter_AdminPaymentOrderDetail_UnknownIDReturnsNotFound(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders/does-not-exist", nil, adminHeaders())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

// include=items (the order bell) skips the COUNT query and so omits "total";
// include=total (the dashboard card) skips the list query and returns an
// empty items array. Without include the envelope is unchanged.
func TestRouter_AdminPaymentOrders_IncludeItemsOmitsTotal(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentOrderViaSQL(t, "order-1", "T-01", "DONE", "SUCCEEDED", 8000, base)
	seedPaymentOrderViaSQL(t, "order-2", "T-02", "DONE", "SUCCEEDED", 5000, base.Add(time.Hour))

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders?status=DONE&pageSize=20&include=items", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v (body = %s)", err, rec.Body.String())
	}
	if _, ok := envelope["total"]; ok {
		t.Errorf("envelope has total, want it omitted: %s", rec.Body.String())
	}
	var items []struct {
		OrderID string `json:"orderId"`
	}
	if err := json.Unmarshal(envelope["items"], &items); err != nil {
		t.Fatalf("decode items: %v", err)
	}
	if len(items) != 2 || items[0].OrderID != "order-2" {
		t.Fatalf("items = %+v, want order-2 then order-1", items)
	}
	if string(envelope["page"]) != "1" || string(envelope["pageSize"]) != "20" {
		t.Errorf("page/pageSize = %s/%s, want 1/20", envelope["page"], envelope["pageSize"])
	}
}

func TestRouter_AdminPaymentOrders_IncludeTotalReturnsEmptyItems(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentOrderViaSQL(t, "order-1", "T-01", "READY", "PENDING", 8000, base)
	seedPaymentOrderViaSQL(t, "order-2", "T-02", "READY", "PENDING", 5000, base.Add(time.Hour))

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders?status=READY&pageSize=1&include=total", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope struct {
		Items []json.RawMessage `json:"items"`
		Total *int              `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v (body = %s)", err, rec.Body.String())
	}
	if envelope.Items == nil || len(envelope.Items) != 0 {
		t.Errorf("items = %v, want an empty array (body = %s)", envelope.Items, rec.Body.String())
	}
	if envelope.Total == nil || *envelope.Total != 2 {
		t.Errorf("total = %v, want 2 (body = %s)", envelope.Total, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrders_RejectsUnknownInclude(t *testing.T) {
	handler := resetServer(t)

	for _, include := range []string{"all", "items,total", "ITEMS"} {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders?include="+include, nil, adminHeaders())
		if rec.Code != http.StatusBadRequest {
			t.Errorf("include=%s: status = %d, want %d, body = %s", include, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
	}
}
