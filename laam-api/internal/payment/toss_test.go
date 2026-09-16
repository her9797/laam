package payment

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientConfirm(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/payments/confirm" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		wantAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte("live-secret:"))
		if got := r.Header.Get("Authorization"); got != wantAuth {
			t.Fatalf("Authorization = %q, want Basic credentials", got)
		}
		if got := r.Header.Get("Idempotency-Key"); got != "order-123456" {
			t.Fatalf("Idempotency-Key = %q", got)
		}

		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["paymentKey"] != "payment-key" || body["orderId"] != "order-123456" || body["amount"] != float64(10000) {
			t.Fatalf("body = %#v", body)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"paymentKey":"payment-key",
			"orderId":"order-123456",
			"status":"DONE",
			"method":"카드",
			"totalAmount":10000,
			"suppliedAmount":9091,
			"vat":909,
			"taxFreeAmount":0,
			"approvedAt":"2026-09-05T12:34:56+09:00"
		}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "live-secret", server.Client())
	result, err := client.Confirm(context.Background(), ConfirmRequest{
		PaymentKey: "payment-key",
		OrderID:    "order-123456",
		Amount:     10000,
	})
	if err != nil {
		t.Fatalf("Confirm() error = %v", err)
	}
	if result.Status != "DONE" || result.TotalAmount != 10000 || result.VAT != 909 {
		t.Fatalf("Confirm() = %+v", result)
	}
}

func TestClientConfirmReturnsAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":"잘못된 요청입니다."}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "live-secret", server.Client())
	_, err := client.Confirm(context.Background(), ConfirmRequest{
		PaymentKey: "payment-key",
		OrderID:    "order-123456",
		Amount:     10000,
	})
	apiErr, ok := err.(*APIError)
	if !ok || apiErr.StatusCode != http.StatusBadRequest || apiErr.Code != "INVALID_REQUEST" {
		t.Fatalf("Confirm() error = %#v", err)
	}
}
