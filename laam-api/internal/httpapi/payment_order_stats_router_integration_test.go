package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func seedDonePaymentOrderViaSQL(t *testing.T, id string, tableNumber string, categoryName string, paymentMethod string, amount int64, approvedAt time.Time) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status,
			payment_method, approved_at, pos_sync_status, created_at
		) VALUES ($1, 'Item', $2, $3, $4, 'DONE', $5, $6, 'SUCCEEDED', $6)
	`, id, categoryName, tableNumber, amount, paymentMethod, approvedAt)
	if err != nil {
		t.Fatalf("seed DONE payment_orders %q: %v", id, err)
	}
}

func TestRouter_AdminPaymentOrderStats_RequiresAdminAuth(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders/stats?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z", nil, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrderStats_RejectsNonGet(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/payment-orders/stats?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z", nil, adminHeaders())
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusMethodNotAllowed, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrderStats_RejectsMissingRange(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders/stats", nil, adminHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestRouter_AdminPaymentOrderStats_ReturnsAggregatedStats(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedDonePaymentOrderViaSQL(t, "stat-1", "1", "Drinks", "카드", 8000, base)
	seedDonePaymentOrderViaSQL(t, "stat-2", "2", "Food", "간편결제", 15000, base.Add(time.Hour))

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-orders/stats?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var stats struct {
		Summary struct {
			TotalRevenue      int64 `json:"totalRevenue"`
			OrderCount        int   `json:"orderCount"`
			AverageOrderValue int64 `json:"averageOrderValue"`
		} `json:"summary"`
		Trend struct {
			Unit    string `json:"unit"`
			Buckets []struct {
				Bucket     string `json:"bucket"`
				Revenue    int64  `json:"revenue"`
				OrderCount int    `json:"orderCount"`
			} `json:"buckets"`
		} `json:"trend"`
		ByCategory      []struct{ CategoryName string }  `json:"byCategory"`
		ByPaymentMethod []struct{ PaymentMethod string } `json:"byPaymentMethod"`
		ByTable         []struct{ TableNumber string }   `json:"byTable"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode stats: %v (body = %s)", err, rec.Body.String())
	}

	if stats.Summary.TotalRevenue != 23000 || stats.Summary.OrderCount != 2 {
		t.Fatalf("Summary = %+v, want totalRevenue=23000 orderCount=2", stats.Summary)
	}
	if len(stats.ByCategory) != 2 || len(stats.ByPaymentMethod) != 2 || len(stats.ByTable) != 2 {
		t.Fatalf("stats = %+v, want 2 entries in each breakdown", stats)
	}
}
