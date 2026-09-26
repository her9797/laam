package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// seedPaymentBillViaSQL creates a synced PAID bill with one DONE menu row
// and one APPROVED payment of sourceType.
func seedPaymentBillViaSQL(t *testing.T, id string, tableNumber string, sourceType string, amount int64, openedAt time.Time) {
	t.Helper()
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO pos_bills (id, pos_order_id, table_number, status, opened_at, completed_at, payments_synced_at)
		VALUES ($1, 'pos-' || $1, $2, 'PAID', $3, $3, $3)
	`, id, tableNumber, openedAt); err != nil {
		t.Fatalf("seed pos_bills %q: %v", id, err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status, pos_sync_status,
			pos_order_id, bill_id, approved_at, created_at
		) VALUES ($1 || '-menu', 'Beer', 'Drinks', $2, $3, 'DONE', 'SUCCEEDED', 'pos-' || $1, $1, $4, $4)
	`, id, tableNumber, amount, openedAt); err != nil {
		t.Fatalf("seed payment_orders for %q: %v", id, err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO pos_payments (id, bill_id, state, source_type, payment_method, card_brand, amount, approved_no, approved_at)
		VALUES ($1 || '-pay', $1, 'APPROVED', $2, $2, 'BC', $3, 'A-1', $4)
	`, id, sourceType, amount, openedAt); err != nil {
		t.Fatalf("seed pos_payments for %q: %v", id, err)
	}
}

func TestRouter_AdminPaymentBills_RequiresAdminAuth(t *testing.T) {
	handler := resetServer(t)

	for _, path := range []string{"/api/v1/admin/payment-bills", "/api/v1/admin/payment-bills/bill-1"} {
		rec := doRequest(t, handler, http.MethodGet, path, nil, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("GET %s status = %d, want %d, body = %s", path, rec.Code, http.StatusUnauthorized, rec.Body.String())
		}
	}
}

func TestRouter_AdminPaymentBills_RejectsNonGet(t *testing.T) {
	handler := resetServer(t)

	for _, path := range []string{"/api/v1/admin/payment-bills", "/api/v1/admin/payment-bills/bill-1"} {
		rec := doRequest(t, handler, http.MethodPost, path, nil, adminHeaders())
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("POST %s status = %d, want %d, body = %s", path, rec.Code, http.StatusMethodNotAllowed, rec.Body.String())
		}
	}
}

func TestRouter_AdminPaymentBills_ListReturnsFilteredEnvelope(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentBillViaSQL(t, "bill-card", "T-01", "CARD", 18000, base)
	seedPaymentBillViaSQL(t, "bill-cash", "T-02", "CASH", 9000, base.Add(time.Hour))

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-bills?sourceType=CARD&pageSize=10", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope struct {
		Items []struct {
			ID          string `json:"id"`
			POSOrderID  string `json:"posOrderId"`
			TableNumber string `json:"tableNumber"`
			Status      string `json:"status"`
			OpenedAt    string `json:"openedAt"`
			TotalAmount int64  `json:"totalAmount"`
			PaidAmount  int64  `json:"paidAmount"`
			Payments    []struct {
				SourceType    string `json:"sourceType"`
				PaymentMethod string `json:"paymentMethod"`
				Amount        int64  `json:"amount"`
				State         string `json:"state"`
			} `json:"payments"`
			MenuCount   int      `json:"menuCount"`
			MenuPreview []string `json:"menuPreview"`
		} `json:"items"`
		Page     int `json:"page"`
		PageSize int `json:"pageSize"`
		Total    int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v, body = %s", err, rec.Body.String())
	}
	if envelope.Total != 1 || envelope.Page != 1 || envelope.PageSize != 10 || len(envelope.Items) != 1 {
		t.Fatalf("envelope = %+v", envelope)
	}
	item := envelope.Items[0]
	if item.ID != "bill-card" || item.POSOrderID != "pos-bill-card" || item.TableNumber != "T-01" || item.Status != "PAID" ||
		item.OpenedAt != "2026-01-10T12:00:00Z" || item.TotalAmount != 18000 || item.PaidAmount != 18000 ||
		item.MenuCount != 1 || len(item.MenuPreview) != 1 || item.MenuPreview[0] != "Beer" {
		t.Errorf("item = %+v", item)
	}
	if len(item.Payments) != 1 || item.Payments[0].SourceType != "CARD" || item.Payments[0].Amount != 18000 || item.Payments[0].State != "APPROVED" {
		t.Errorf("payments = %+v", item.Payments)
	}
}

func TestRouter_AdminPaymentBills_ListSearchesTableAndMenuName(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedPaymentBillViaSQL(t, "bill-a", "T-01", "CARD", 18000, base)
	seedPaymentBillViaSQL(t, "bill-b", "T-02", "CASH", 9000, base.Add(time.Hour))

	cases := []struct {
		query string
		want  []string
	}{
		{"q=t-01", []string{"bill-a"}},
		{"q=beer", []string{"bill-b", "bill-a"}},
		{"q=pizza", []string{}},
	}
	for _, tc := range cases {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-bills?"+tc.query, nil, adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d, body = %s", tc.query, rec.Code, http.StatusOK, rec.Body.String())
		}
		var envelope struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
			Total int `json:"total"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
			t.Fatalf("%s decode: %v, body = %s", tc.query, err, rec.Body.String())
		}
		got := make([]string, 0, len(envelope.Items))
		for _, item := range envelope.Items {
			got = append(got, item.ID)
		}
		if envelope.Total != len(tc.want) || len(got) != len(tc.want) {
			t.Fatalf("%s ids/total = %v/%d, want %v", tc.query, got, envelope.Total, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("%s ids = %v, want %v", tc.query, got, tc.want)
			}
		}
	}
}

func TestRouter_AdminPaymentBills_ListRejectsInvalidQuery(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-bills?status=DONE", nil, adminHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestRouter_AdminPaymentBills_DetailReturnsPaymentsAndMenuItems(t *testing.T) {
	handler := resetServer(t)
	seedPaymentBillViaSQL(t, "bill-card", "T-01", "CARD", 18000, time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC))

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-bills/bill-card", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var detail struct {
		ID               string `json:"id"`
		Status           string `json:"status"`
		TotalAmount      int64  `json:"totalAmount"`
		PaidAmount       int64  `json:"paidAmount"`
		DiscountAmount   *int64 `json:"discountAmount"`
		PaymentsSyncedAt string `json:"paymentsSyncedAt"`
		Payments         []struct {
			ID         string `json:"id"`
			SourceType string `json:"sourceType"`
			CardBrand  string `json:"cardBrand"`
			ApprovedNo string `json:"approvedNo"`
			ApprovedAt string `json:"approvedAt"`
			Amount     int64  `json:"amount"`
		} `json:"payments"`
		MenuItems []struct {
			OrderID      string `json:"orderId"`
			MenuItemName string `json:"menuItemName"`
			Status       string `json:"status"`
			Amount       int64  `json:"amount"`
		} `json:"menuItems"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode: %v, body = %s", err, rec.Body.String())
	}
	if detail.ID != "bill-card" || detail.Status != "PAID" || detail.TotalAmount != 18000 || detail.PaidAmount != 18000 ||
		detail.DiscountAmount != nil || detail.PaymentsSyncedAt != "2026-01-10T12:00:00Z" {
		t.Errorf("detail = %+v", detail)
	}
	if len(detail.Payments) != 1 || detail.Payments[0].ID != "bill-card-pay" || detail.Payments[0].CardBrand != "BC" ||
		detail.Payments[0].ApprovedNo != "A-1" || detail.Payments[0].ApprovedAt != "2026-01-10T12:00:00Z" {
		t.Errorf("payments = %+v", detail.Payments)
	}
	if len(detail.MenuItems) != 1 || detail.MenuItems[0].OrderID != "bill-card-menu" || detail.MenuItems[0].Status != "DONE" {
		t.Errorf("menuItems = %+v", detail.MenuItems)
	}
}

func TestRouter_AdminPaymentBills_DetailUnknownIDIsNotFound(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/payment-bills/missing", nil, adminHeaders())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}
