package payment

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var ErrNotConfigured = errors.New("toss payments is not configured")

type ConfirmRequest struct {
	PaymentKey string `json:"paymentKey"`
	OrderID    string `json:"orderId"`
	Amount     int64  `json:"amount"`
}

type ConfirmResult struct {
	PaymentKey     string `json:"paymentKey"`
	OrderID        string `json:"orderId"`
	Status         string `json:"status"`
	Method         string `json:"method"`
	TotalAmount    int64  `json:"totalAmount"`
	SuppliedAmount int64  `json:"suppliedAmount"`
	VAT            int64  `json:"vat"`
	TaxFreeAmount  int64  `json:"taxFreeAmount"`
	ApprovedAt     string `json:"approvedAt"`
}

type APIError struct {
	StatusCode int
	Code       string `json:"code"`
	Message    string `json:"message"`
}

func (e *APIError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("toss payments request failed with status %d", e.StatusCode)
	}
	return fmt.Sprintf("toss payments request failed: %s", e.Code)
}

type Client struct {
	baseURL    string
	secretKey  string
	httpClient *http.Client
}

func NewClient(baseURL string, secretKey string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		secretKey:  strings.TrimSpace(secretKey),
		httpClient: httpClient,
	}
}

func (c *Client) Confirm(ctx context.Context, payload ConfirmRequest) (ConfirmResult, error) {
	if c.secretKey == "" {
		return ConfirmResult{}, ErrNotConfigured
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return ConfirmResult{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/payments/confirm", bytes.NewReader(body))
	if err != nil {
		return ConfirmResult{}, err
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(c.secretKey+":")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", payload.OrderID)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return ConfirmResult{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		apiErr := &APIError{StatusCode: resp.StatusCode}
		limited := io.LimitReader(resp.Body, 1<<20)
		_ = json.NewDecoder(limited).Decode(apiErr)
		return ConfirmResult{}, apiErr
	}

	var result ConfirmResult
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return ConfirmResult{}, err
	}
	return result, nil
}
