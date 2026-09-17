// Package objectstore stores private files in a Supabase Storage bucket
// through its REST API (https://supabase.com/docs/guides/storage), using a
// server-only secret key. Objects are never public: reads go through
// short-lived signed URLs.
package objectstore

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

var (
	ErrNotConfigured = errors.New("object storage is not configured")
	ErrNotFound      = errors.New("object not found")
)

// errorBodyLimit bounds how much of a storage error response is read to
// recognise a missing object.
const errorBodyLimit = 4096

type Client struct {
	supabaseURL string
	apiKey      string
	bucket      string
	httpClient  *http.Client
}

// New builds a Client. An empty supabaseURL or apiKey is valid and means
// "disabled": every call returns ErrNotConfigured.
func New(supabaseURL string, apiKey string, bucket string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{
		supabaseURL: strings.TrimRight(strings.TrimSpace(supabaseURL), "/"),
		apiKey:      strings.TrimSpace(apiKey),
		bucket:      strings.TrimSpace(bucket),
		httpClient:  httpClient,
	}
}

func (c *Client) Configured() bool {
	return c.supabaseURL != "" && c.apiKey != "" && c.bucket != ""
}

// Upload stores content at objectPath, overwriting any existing object.
func (c *Client) Upload(ctx context.Context, objectPath string, contentType string, content []byte) error {
	req, err := c.newRequest(ctx, http.MethodPost, "/storage/v1/object/", objectPath, bytes.NewReader(content))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("x-upsert", "true")
	return c.do(req, nil)
}

// Delete removes objectPath. A missing object returns ErrNotFound.
func (c *Client) Delete(ctx context.Context, objectPath string) error {
	req, err := c.newRequest(ctx, http.MethodDelete, "/storage/v1/object/", objectPath, nil)
	if err != nil {
		return err
	}
	return c.do(req, nil)
}

// SignedURL returns an absolute URL that reads objectPath until expiresIn
// elapses.
func (c *Client) SignedURL(ctx context.Context, objectPath string, expiresIn time.Duration) (string, error) {
	body, err := json.Marshal(map[string]int{"expiresIn": int(expiresIn / time.Second)})
	if err != nil {
		return "", err
	}
	req, err := c.newRequest(ctx, http.MethodPost, "/storage/v1/object/sign/", objectPath, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	var result struct {
		SignedURL string `json:"signedURL"`
	}
	if err := c.do(req, &result); err != nil {
		return "", err
	}
	if !strings.HasPrefix(result.SignedURL, "/") {
		return "", errors.New("objectstore: sign response has no signedURL")
	}
	return c.supabaseURL + "/storage/v1" + result.SignedURL, nil
}

func (c *Client) newRequest(ctx context.Context, method string, prefix string, objectPath string, body io.Reader) (*http.Request, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	segments := strings.Split(objectPath, "/")
	for i, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return nil, fmt.Errorf("objectstore: invalid object path %q", objectPath)
		}
		segments[i] = url.PathEscape(segment)
	}
	endpoint := c.supabaseURL + prefix + url.PathEscape(c.bucket) + "/" + strings.Join(segments, "/")

	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, fmt.Errorf("objectstore: build request: %w", err)
	}
	req.Header.Set("apikey", c.apiKey)
	// Legacy service_role keys are JWTs and are also accepted as a Bearer
	// token; new sb_secret_ keys are not JWTs and go in apikey only.
	if !strings.HasPrefix(c.apiKey, "sb_") {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	return req, nil
}

func (c *Client) do(req *http.Request, out any) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		// url.Error only carries the method and URL, never request headers.
		return fmt.Errorf("objectstore: %s request failed: %w", req.Method, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit))
		if isNotFoundResponse(resp.StatusCode, body) {
			return ErrNotFound
		}
		return fmt.Errorf("objectstore: %s returned status %d", req.Method, resp.StatusCode)
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, errorBodyLimit))
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("objectstore: decode response: %w", err)
	}
	return nil
}

// isNotFoundResponse recognises a missing object. Supabase Storage reports
// it either as HTTP 404 or as HTTP 400 with {"statusCode":"404"}.
func isNotFoundResponse(status int, body []byte) bool {
	if status == http.StatusNotFound {
		return true
	}
	if status != http.StatusBadRequest {
		return false
	}
	var payload struct {
		StatusCode string `json:"statusCode"`
		Error      string `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return false
	}
	return payload.StatusCode == "404" || strings.EqualFold(payload.Error, "not_found")
}
