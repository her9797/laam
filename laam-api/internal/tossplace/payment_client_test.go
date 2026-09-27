package tossplace

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

const paymentJSON = `{
	"id": "pay-1",
	"merchantId": 42,
	"orderId": "pos-order-9",
	"state": "APPROVED",
	"sourceType": "ACCOUNT_TRANSFER",
	"paymentMethod": "계좌이체",
	"amount": 30000,
	"taxAmount": 2727,
	"supplyAmount": 27273,
	"taxExemptAmount": 0,
	"tipAmount": 0,
	"approvedNo": "A-1",
	"approvedAt": "2026-09-19T03:34:56Z",
	"cardDetails": {"cardBrand": "신한", "cardNo": "1234-****-****-5678"},
	"createdAt": "2026-09-19T03:34:56Z",
	"updatedAt": "2026-09-19T03:34:56Z"
}`

func TestClientGetPaymentsByOrderID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api-public/openapi/v1/merchants/merchant-123/payment/payments/by-order-id" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.URL.Query().Get("orderId") != "pos-order-9" {
			t.Fatalf("orderId query = %q", r.URL.Query().Get("orderId"))
		}
		if r.Header.Get("x-access-key") != "access" || r.Header.Get("x-secret-key") != "secret" {
			t.Fatal("missing Toss Place authentication headers")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":[` + paymentJSON + `]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	payments, err := client.GetPaymentsByOrderID(context.Background(), "pos-order-9")
	if err != nil {
		t.Fatalf("GetPaymentsByOrderID() error = %v", err)
	}
	if len(payments) != 1 {
		t.Fatalf("payments = %+v", payments)
	}
	p := payments[0]
	if p.ID != "pay-1" || p.OrderID != "pos-order-9" || p.State != "APPROVED" || p.SourceType != "ACCOUNT_TRANSFER" ||
		p.PaymentMethod != "계좌이체" || p.Amount != 30000 || p.TaxAmount != 2727 || p.SupplyAmount != 27273 ||
		p.ApprovedNo != "A-1" || p.ApprovedAt != "2026-09-19T03:34:56Z" || p.CardDetails.CardBrand != "신한" {
		t.Fatalf("payment = %+v", p)
	}
}

func TestClientGetPaymentsByOrderIDAcceptsWrappedList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":{"payments":[` + paymentJSON + `]}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	payments, err := client.GetPaymentsByOrderID(context.Background(), "pos-order-9")
	if err != nil {
		t.Fatalf("GetPaymentsByOrderID() error = %v", err)
	}
	if len(payments) != 1 || payments[0].ID != "pay-1" {
		t.Fatalf("payments = %+v", payments)
	}
}

func TestClientGetPayment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api-public/openapi/v1/merchants/merchant-123/payment/payments/pay-1" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":` + paymentJSON + `}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	payment, err := client.GetPayment(context.Background(), "pay-1")
	if err != nil {
		t.Fatalf("GetPayment() error = %v", err)
	}
	if payment.ID != "pay-1" || payment.SourceType != "ACCOUNT_TRANSFER" {
		t.Fatalf("payment = %+v", payment)
	}
}

func TestClientGetPaymentsByOrderIDReturnsAPIErrorOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"resultType":"FAILURE","error":{"errorCode":"ORDER_NOT_FOUND","reason":"no such order"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	_, err := client.GetPaymentsByOrderID(context.Background(), "missing")
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != "ORDER_NOT_FOUND" {
		t.Fatalf("error = %+v, want an APIError with code ORDER_NOT_FOUND", err)
	}
}

func TestClientGetPaymentsByOrderIDRequiresConfiguration(t *testing.T) {
	client := NewClient("http://example.invalid", "", "", "", nil)
	if _, err := client.GetPaymentsByOrderID(context.Background(), "x"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("error = %v, want ErrNotConfigured", err)
	}
}

func TestClientGetOrderIncludesChargePrice(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":{"id":"pos-order-9","chargePrice":{"totalAmount":27000,"discountAmount":3000},"lineItems":[]}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	order, err := client.GetOrder(context.Background(), "pos-order-9")
	if err != nil {
		t.Fatalf("GetOrder() error = %v", err)
	}
	if order.ChargePrice.TotalAmount != 27000 || order.ChargePrice.DiscountAmount != 3000 {
		t.Fatalf("chargePrice = %+v", order.ChargePrice)
	}
}

func TestClientGetOrderIncludesCancelledAt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":{"id":"pos-order-9","orderState":"CANCELLED","cancelledAt":"2026-09-19T04:00:00Z","lineItems":[]}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	order, err := client.GetOrder(context.Background(), "pos-order-9")
	if err != nil {
		t.Fatalf("GetOrder() error = %v", err)
	}
	if order.CancelledAt != "2026-09-19T04:00:00Z" {
		t.Fatalf("cancelledAt = %q, want 2026-09-19T04:00:00Z", order.CancelledAt)
	}
}
