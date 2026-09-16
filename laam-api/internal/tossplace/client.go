package tossplace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrNotConfigured = errors.New("toss place is not configured")

type PaidOrder struct {
	OrderID           string
	OrderNumber       string
	MenuItemID        string
	TossCatalogItemID string
	MenuItemName      string
	CategoryName      string
	TableNumber       string
	RequestNote       string
	BaseAmount        int64
	Amount            int64
	OptionChoices     []OrderOptionChoice
	VAT               int64
	SuppliedAmount    int64
	TaxFreeAmount     int64
	PaymentKey        string
	ApprovedAt        time.Time
}

// UnpaidOrder represents a postpaid order that should be opened in Toss POS
// without recording a payment. Payment is completed later at the store.
type UnpaidOrder struct {
	OrderID           string
	OrderNumber       string
	MenuItemID        string
	TossCatalogItemID string
	MenuItemName      string
	CategoryName      string
	TableNumber       string
	RequestNote       string
	BaseAmount        int64
	Amount            int64
	OptionChoices     []OrderOptionChoice
	OpenedAt          time.Time
}

type CreateOrderResult struct {
	OrderID string
}

type OrderOptionChoice struct {
	OptionID       string
	OptionChoiceID string
	Title          string
	Price          int64
	Quantity       int64
}

type APIError struct {
	StatusCode int
	EventID    string
	Code       string
	Reason     string
}

func (e *APIError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("toss place request failed with status %d", e.StatusCode)
	}
	return fmt.Sprintf("toss place request failed: %s", e.Code)
}

type Client struct {
	baseURL    string
	accessKey  string
	secretKey  string
	merchantID string
	httpClient *http.Client
}

func NewClient(baseURL string, accessKey string, secretKey string, merchantID string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		accessKey:  strings.TrimSpace(accessKey),
		secretKey:  strings.TrimSpace(secretKey),
		merchantID: strings.TrimSpace(merchantID),
		httpClient: httpClient,
	}
}

type createOrderBody struct {
	Order    createOrder     `json:"order"`
	Payments []createPayment `json:"payments"`
}

type createOrder struct {
	OrderKey    string           `json:"orderKey"`
	OrderNumber string           `json:"orderNumber"`
	LineItems   []createLineItem `json:"lineItems"`
	ChargePrice chargePrice      `json:"chargePrice"`
	Memo        string           `json:"memo,omitempty"`
	OpenedAt    string           `json:"openedAt"`
}

type createLineItem struct {
	DiningOption  string                    `json:"diningOption"`
	TargetType    string                    `json:"targetType"`
	TargetID      string                    `json:"targetId,omitempty"`
	Item          *createItem               `json:"item,omitempty"`
	ItemPrice     createItemPrice           `json:"itemPrice"`
	Quantity      int64                     `json:"quantity"`
	OptionChoices []createOrderOptionChoice `json:"optionChoices,omitempty"`
}

type createOrderOptionChoice struct {
	OptionID       string `json:"optionId"`
	OptionChoiceID string `json:"optionChoiceId"`
	Title          string `json:"title,omitempty"`
	Price          int64  `json:"price"`
	Quantity       int64  `json:"quantity"`
}

type createItem struct {
	Title    string         `json:"title"`
	Code     string         `json:"code,omitempty"`
	Category createCategory `json:"category"`
}

type createCategory struct {
	Title string `json:"title"`
	Code  string `json:"code,omitempty"`
}

type createItemPrice struct {
	Title        string `json:"title"`
	PriceType    string `json:"priceType"`
	PriceUnit    int64  `json:"priceUnit"`
	PriceValue   int64  `json:"priceValue"`
	IsTaxFree    bool   `json:"isTaxFree"`
	TaxInclusive bool   `json:"taxInclusive"`
}

type chargePrice struct {
	ListPrice           int64 `json:"listPrice"`
	DiscountAmount      int64 `json:"discountAmount"`
	TipAmount           int64 `json:"tipAmount"`
	ServiceChargeAmount int64 `json:"serviceChargeAmount"`
	TaxAmount           int64 `json:"taxAmount"`
	SupplyAmount        int64 `json:"supplyAmount"`
	TaxExemptAmount     int64 `json:"taxExemptAmount"`
	TotalAmount         int64 `json:"totalAmount"`
}

type createPayment struct {
	ApprovedAt      string    `json:"approvedAt"`
	Amount          int64     `json:"amount"`
	TaxAmount       int64     `json:"taxAmount"`
	SupplyAmount    int64     `json:"supplyAmount"`
	TaxExemptAmount int64     `json:"taxExemptAmount"`
	TipAmount       int64     `json:"tipAmount"`
	PGDetails       pgDetails `json:"pgDetails"`
}

type pgDetails struct {
	Provider      string `json:"provider"`
	TransactionID string `json:"transactionId"`
}

func (c *Client) CreatePaidOrder(ctx context.Context, paid PaidOrder) (CreateOrderResult, error) {
	if c.accessKey == "" || c.secretKey == "" || c.merchantID == "" {
		return CreateOrderResult{}, ErrNotConfigured
	}

	timestamp := paid.ApprovedAt.UTC().Format(time.RFC3339)
	baseAmount := paid.BaseAmount
	if baseAmount <= 0 {
		baseAmount = paid.Amount
	}
	lineItem := createLineItem{
		DiningOption: "HERE",
		TargetType:   "ITEM",
		TargetID:     paid.TossCatalogItemID,
		ItemPrice: createItemPrice{
			Title:        "기본",
			PriceType:    "FIXED",
			PriceUnit:    1,
			PriceValue:   baseAmount,
			IsTaxFree:    false,
			TaxInclusive: true,
		},
		Quantity:      1,
		OptionChoices: createOrderOptionChoices(paid.OptionChoices),
	}
	if paid.TossCatalogItemID == "" {
		lineItem.TargetType = "AD_HOC"
		lineItem.Item = &createItem{
			Title:    paid.MenuItemName,
			Code:     paid.MenuItemID,
			Category: createCategory{Title: paid.CategoryName},
		}
	}

	body := createOrderBody{
		Order: createOrder{
			OrderKey:    paid.OrderID,
			OrderNumber: paid.OrderNumber,
			LineItems:   []createLineItem{lineItem},
			ChargePrice: chargePrice{
				ListPrice:           paid.Amount,
				DiscountAmount:      0,
				TipAmount:           0,
				ServiceChargeAmount: 0,
				TaxAmount:           paid.VAT,
				SupplyAmount:        paid.SuppliedAmount,
				TaxExemptAmount:     paid.TaxFreeAmount,
				TotalAmount:         paid.Amount,
			},
			Memo:     paymentMemo(paid.TableNumber, paid.RequestNote),
			OpenedAt: timestamp,
		},
		Payments: []createPayment{{
			ApprovedAt:      timestamp,
			Amount:          paid.Amount,
			TaxAmount:       paid.VAT,
			SupplyAmount:    paid.SuppliedAmount,
			TaxExemptAmount: paid.TaxFreeAmount,
			TipAmount:       0,
			PGDetails: pgDetails{
				Provider:      "토스페이먼츠",
				TransactionID: paid.PaymentKey,
			},
		}},
	}

	return c.sendCreateOrder(ctx, body)
}

func (c *Client) CreateUnpaidOrder(ctx context.Context, unpaid UnpaidOrder) (CreateOrderResult, error) {
	if c.accessKey == "" || c.secretKey == "" || c.merchantID == "" {
		return CreateOrderResult{}, ErrNotConfigured
	}

	baseAmount := unpaid.BaseAmount
	if baseAmount <= 0 {
		baseAmount = unpaid.Amount
	}
	lineItem := createLineItem{
		DiningOption: "HERE",
		TargetType:   "ITEM",
		TargetID:     unpaid.TossCatalogItemID,
		ItemPrice: createItemPrice{
			Title:        "기본",
			PriceType:    "FIXED",
			PriceUnit:    1,
			PriceValue:   baseAmount,
			IsTaxFree:    false,
			TaxInclusive: true,
		},
		Quantity:      1,
		OptionChoices: createOrderOptionChoices(unpaid.OptionChoices),
	}
	if unpaid.TossCatalogItemID == "" {
		lineItem.TargetType = "AD_HOC"
		lineItem.Item = &createItem{
			Title:    unpaid.MenuItemName,
			Code:     unpaid.MenuItemID,
			Category: createCategory{Title: unpaid.CategoryName},
		}
	}

	vat := unpaid.Amount / 11
	body := createOrderBody{
		Order: createOrder{
			OrderKey:    unpaid.OrderID,
			OrderNumber: unpaid.OrderNumber,
			LineItems:   []createLineItem{lineItem},
			ChargePrice: chargePrice{
				ListPrice:           unpaid.Amount,
				DiscountAmount:      0,
				TipAmount:           0,
				ServiceChargeAmount: 0,
				TaxAmount:           vat,
				SupplyAmount:        unpaid.Amount - vat,
				TaxExemptAmount:     0,
				TotalAmount:         unpaid.Amount,
			},
			Memo:     paymentMemo(unpaid.TableNumber, unpaid.RequestNote),
			OpenedAt: unpaid.OpenedAt.UTC().Format(time.RFC3339),
		},
		Payments: make([]createPayment, 0),
	}

	return c.sendCreateOrder(ctx, body)
}

func createOrderOptionChoices(choices []OrderOptionChoice) []createOrderOptionChoice {
	result := make([]createOrderOptionChoice, 0, len(choices))
	for _, choice := range choices {
		result = append(result, createOrderOptionChoice{
			OptionID:       choice.OptionID,
			OptionChoiceID: choice.OptionChoiceID,
			Title:          choice.Title,
			Price:          choice.Price,
			Quantity:       choice.Quantity,
		})
	}
	return result
}

func (c *Client) sendCreateOrder(ctx context.Context, body createOrderBody) (CreateOrderResult, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return CreateOrderResult{}, err
	}

	endpoint := c.baseURL + "/api-public/openapi/v1/merchants/" + url.PathEscape(c.merchantID) + "/order/orders"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return CreateOrderResult{}, err
	}
	req.Header.Set("x-access-key", c.accessKey)
	req.Header.Set("x-secret-key", c.secretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return CreateOrderResult{}, err
	}
	defer resp.Body.Close()

	var envelope struct {
		ResultType string `json:"resultType"`
		Success    struct {
			ID string `json:"id"`
		} `json:"success"`
		Error struct {
			ErrorCode string `json:"errorCode"`
			Reason    string `json:"reason"`
		} `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&envelope); err != nil {
		return CreateOrderResult{}, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices || envelope.ResultType != "SUCCESS" {
		return CreateOrderResult{}, &APIError{
			StatusCode: resp.StatusCode,
			EventID:    resp.Header.Get("x-toss-event-id"),
			Code:       envelope.Error.ErrorCode,
			Reason:     envelope.Error.Reason,
		}
	}

	return CreateOrderResult{OrderID: envelope.Success.ID}, nil
}

func paymentMemo(tableNumber string, requestNote string) string {
	tableNumber = strings.TrimSpace(tableNumber)
	requestNote = strings.TrimSpace(requestNote)
	parts := make([]string, 0, 3)
	if tableNumber != "" {
		parts = append(parts, "테이블 "+tableNumber)
	}
	if requestNote != "" {
		parts = append(parts, "요청사항: "+requestNote)
	}
	parts = append(parts, "lam 웹 주문")
	return strings.Join(parts, " · ")
}
