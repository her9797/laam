package youtube

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrNotConfigured = errors.New("youtube search is not configured")
	ErrNoResults     = errors.New("youtube search returned no videos")
)

type Video struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	ChannelTitle string `json:"channelTitle"`
}

type APIError struct {
	StatusCode int
}

func (e *APIError) Error() string {
	return fmt.Sprintf("youtube search failed with status %d", e.StatusCode)
}

type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

func NewClient(baseURL string, apiKey string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiKey:     strings.TrimSpace(apiKey),
		httpClient: httpClient,
	}
}

func (c *Client) Search(ctx context.Context, query string) (Video, error) {
	if c.apiKey == "" {
		return Video{}, ErrNotConfigured
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return Video{}, ErrNoResults
	}

	endpoint, err := url.Parse(c.baseURL + "/search")
	if err != nil {
		return Video{}, err
	}
	params := endpoint.Query()
	params.Set("part", "snippet")
	params.Set("type", "video")
	params.Set("maxResults", "1")
	params.Set("videoEmbeddable", "true")
	params.Set("videoSyndicated", "true")
	params.Set("q", query+" official audio")
	params.Set("key", c.apiKey)
	endpoint.RawQuery = params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return Video{}, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return Video{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		return Video{}, &APIError{StatusCode: resp.StatusCode}
	}

	var payload struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
			Snippet struct {
				Title        string `json:"title"`
				ChannelTitle string `json:"channelTitle"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return Video{}, err
	}
	if len(payload.Items) == 0 || strings.TrimSpace(payload.Items[0].ID.VideoID) == "" {
		return Video{}, ErrNoResults
	}

	item := payload.Items[0]
	return Video{
		ID:           strings.TrimSpace(item.ID.VideoID),
		Title:        html.UnescapeString(strings.TrimSpace(item.Snippet.Title)),
		ChannelTitle: html.UnescapeString(strings.TrimSpace(item.Snippet.ChannelTitle)),
	}, nil
}
