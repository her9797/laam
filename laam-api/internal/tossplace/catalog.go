package tossplace

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

type CatalogCategory struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type CatalogPrice struct {
	Title string `json:"title"`
	Type  string `json:"priceType"`
	Unit  int64  `json:"priceUnit"`
	Value int64  `json:"priceValue"`
}

type CatalogOptionChoice struct {
	ID              string `json:"id"`
	OptionID        string `json:"optionId"`
	Title           string `json:"title"`
	State           string `json:"state"`
	Enabled         bool   `json:"enabled"`
	Order           int    `json:"order"`
	PriceValue      int64  `json:"priceValue"`
	ImageURL        string `json:"imageUrl"`
	QuantityEnabled bool   `json:"quantityEnabled"`
	MinQuantity     int64  `json:"minQuantity"`
	MaxQuantity     int64  `json:"maxQuantity"`
}

type CatalogOption struct {
	ID         string                `json:"id"`
	Title      string                `json:"title"`
	Enabled    bool                  `json:"enabled"`
	Order      int                   `json:"order"`
	Choices    []CatalogOptionChoice `json:"choices"`
	Required   bool                  `json:"required"`
	MinChoices int                   `json:"minChoices"`
	MaxChoices int                   `json:"maxChoices"`
}

type CatalogItem struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	ImageURL    string          `json:"imageUrl"`
	Labels      []string        `json:"labels"`
	Category    CatalogCategory `json:"category"`
	Price       CatalogPrice    `json:"price"`
	Options     []CatalogOption `json:"options"`
	State       string          `json:"state"`
	Enabled     bool            `json:"enabled"`
	Order       int             `json:"order"`
}

func (c *Client) ListCatalogItems(ctx context.Context) ([]CatalogItem, error) {
	if c.accessKey == "" || c.secretKey == "" || c.merchantID == "" {
		return nil, ErrNotConfigured
	}

	const pageSize = 100
	items := make([]CatalogItem, 0)
	for page := 1; page <= 100; page++ {
		endpoint, err := url.Parse(c.baseURL + "/api-public/openapi/v1/merchants/" + url.PathEscape(c.merchantID) + "/catalog/items")
		if err != nil {
			return nil, err
		}
		query := endpoint.Query()
		query.Set("page", strconv.Itoa(page))
		query.Set("size", strconv.Itoa(pageSize))
		endpoint.RawQuery = query.Encode()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("x-access-key", c.accessKey)
		req.Header.Set("x-secret-key", c.secretKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, err
		}
		var envelope struct {
			ResultType string        `json:"resultType"`
			Success    []CatalogItem `json:"success"`
			Error      struct {
				ErrorCode string `json:"errorCode"`
				Reason    string `json:"reason"`
			} `json:"error"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&envelope)
		_ = resp.Body.Close()
		if decodeErr != nil {
			return nil, decodeErr
		}
		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices || envelope.ResultType != "SUCCESS" {
			return nil, &APIError{
				StatusCode: resp.StatusCode,
				EventID:    resp.Header.Get("x-toss-event-id"),
				Code:       envelope.Error.ErrorCode,
				Reason:     envelope.Error.Reason,
			}
		}

		items = append(items, envelope.Success...)
		if len(envelope.Success) < pageSize {
			return items, nil
		}
	}

	return items, nil
}
