package tossplace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClientCreatePaidOrder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api-public/openapi/v1/merchants/merchant-123/order/orders" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("x-access-key") != "access" || r.Header.Get("x-secret-key") != "secret" {
			t.Fatal("missing Toss Place authentication headers")
		}

		var body createOrderBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body.Order.OrderKey != "order-123456" || len(body.Order.LineItems) != 1 {
			t.Fatalf("order = %+v", body.Order)
		}
		line := body.Order.LineItems[0]
		if line.TargetType != "AD_HOC" || line.Item == nil || line.Item.Title != "하우스 하이볼" || line.ItemPrice.PriceValue != 10000 {
			t.Fatalf("line item = %+v", line)
		}
		if len(body.Payments) != 1 || body.Payments[0].PGDetails.TransactionID != "payment-key" {
			t.Fatalf("payments = %+v", body.Payments)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":{"id":"pos-order-1"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	result, err := client.CreatePaidOrder(context.Background(), PaidOrder{
		OrderID:        "order-123456",
		OrderNumber:    "테이블 3",
		MenuItemID:     "house-highball",
		MenuItemName:   "하우스 하이볼",
		CategoryName:   "하이볼",
		TableNumber:    "3",
		Amount:         10000,
		VAT:            909,
		SuppliedAmount: 9091,
		TaxFreeAmount:  0,
		PaymentKey:     "payment-key",
		ApprovedAt:     time.Date(2026, 9, 5, 3, 34, 56, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("CreatePaidOrder() error = %v", err)
	}
	if result.OrderID != "pos-order-1" {
		t.Fatalf("OrderID = %q", result.OrderID)
	}
}

func TestClientCreatePaidOrderUsesCatalogItemWhenMapped(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body createOrderBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		line := body.Order.LineItems[0]
		if line.TargetType != "ITEM" || line.TargetID != "pos-item-1" {
			t.Fatalf("line item = %+v, want mapped ITEM", line)
		}
		if line.Item != nil {
			t.Fatalf("ad-hoc item must be omitted for mapped catalog item: %+v", line.Item)
		}
		_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":{"id":"pos-order-1"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	_, err := client.CreatePaidOrder(context.Background(), PaidOrder{
		OrderID:           "order-123456",
		OrderNumber:       "테이블 3",
		MenuItemID:        "local-item-1",
		TossCatalogItemID: "pos-item-1",
		MenuItemName:      "하우스 하이볼",
		CategoryName:      "하이볼",
		Amount:            10000,
		VAT:               909,
		SuppliedAmount:    9091,
		PaymentKey:        "payment-key",
		ApprovedAt:        time.Date(2026, 9, 5, 3, 34, 56, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("CreatePaidOrder() error = %v", err)
	}
}

func TestClientCreateUnpaidOrderOmitsPayments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api-public/openapi/v1/merchants/merchant-123/order/orders" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}

		var body createOrderBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body.Payments == nil || len(body.Payments) != 0 {
			t.Fatalf("payments = %#v, want an empty array", body.Payments)
		}
		if body.Order.OpenedAt != "2026-09-05T03:34:56Z" {
			t.Fatalf("openedAt = %q", body.Order.OpenedAt)
		}
		if body.Order.ChargePrice.TotalAmount != 10500 || body.Order.ChargePrice.TaxAmount != 954 || body.Order.ChargePrice.SupplyAmount != 9546 {
			t.Fatalf("chargePrice = %+v", body.Order.ChargePrice)
		}
		if body.Order.LineItems[0].ItemPrice.PriceValue != 10000 || len(body.Order.LineItems[0].OptionChoices) != 1 {
			t.Fatalf("line item options = %+v", body.Order.LineItems[0])
		}
		choice := body.Order.LineItems[0].OptionChoices[0]
		if choice.OptionID != "option-1" || choice.OptionChoiceID != "choice-1" || choice.Price != 500 || choice.Quantity != 1 {
			t.Fatalf("option choice = %+v", choice)
		}
		if body.Order.Memo != "테이블 3 · 요청사항: 얼음은 적게 주세요 · lam 웹 주문" {
			t.Fatalf("memo = %q", body.Order.Memo)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":{"id":"pos-order-unpaid"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	result, err := client.CreateUnpaidOrder(context.Background(), UnpaidOrder{
		OrderID:           "order-123456",
		OrderNumber:       "테이블 3",
		MenuItemID:        "local-item-1",
		TossCatalogItemID: "pos-item-1",
		MenuItemName:      "하우스 하이볼",
		CategoryName:      "하이볼",
		TableNumber:       "3",
		RequestNote:       "얼음은 적게 주세요",
		BaseAmount:        10000,
		Amount:            10500,
		OptionChoices: []OrderOptionChoice{{
			OptionID:       "option-1",
			OptionChoiceID: "choice-1",
			Title:          "샷 추가",
			Price:          500,
			Quantity:       1,
		}},
		OpenedAt: time.Date(2026, 9, 5, 3, 34, 56, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("CreateUnpaidOrder() error = %v", err)
	}
	if result.OrderID != "pos-order-unpaid" {
		t.Fatalf("OrderID = %q", result.OrderID)
	}
}
