package objectstore

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClient_ConfiguredRequiresURLAndKey(t *testing.T) {
	cases := []struct {
		url, key string
		want     bool
	}{
		{"", "", false},
		{"https://x.supabase.co", "", false},
		{"", "secret", false},
		{"https://x.supabase.co", "secret", true},
	}
	for _, tc := range cases {
		client := New(tc.url, tc.key, "expense-receipts", nil)
		if got := client.Configured(); got != tc.want {
			t.Errorf("Configured(%q, %q) = %v, want %v", tc.url, tc.key, got, tc.want)
		}
		if !tc.want {
			if err := client.Upload(context.Background(), "a.png", "image/png", []byte("x")); !errors.Is(err, ErrNotConfigured) {
				t.Errorf("Upload err = %v, want ErrNotConfigured", err)
			}
		}
	}
}

func TestClient_UploadSendsObjectWithSecretKey(t *testing.T) {
	var gotMethod, gotPath, gotAPIKey, gotAuth, gotType, gotUpsert string
	var gotBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.EscapedPath()
		gotAPIKey, gotAuth = r.Header.Get("apikey"), r.Header.Get("Authorization")
		gotType, gotUpsert = r.Header.Get("Content-Type"), r.Header.Get("x-upsert")
		gotBody, _ = io.ReadAll(r.Body)
		_, _ = w.Write([]byte(`{"Key":"expense-receipts/receipts/r1/abc.png"}`))
	}))
	defer server.Close()

	client := New(server.URL+"/", "sb_secret_test", "expense-receipts", server.Client())
	if err := client.Upload(context.Background(), "receipts/r1/abc.png", "image/png", []byte("png-bytes")); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/storage/v1/object/expense-receipts/receipts/r1/abc.png" {
		t.Fatalf("request = %s %s", gotMethod, gotPath)
	}
	if gotAPIKey != "sb_secret_test" || gotType != "image/png" || gotUpsert != "true" || string(gotBody) != "png-bytes" {
		t.Fatalf("apikey=%q type=%q upsert=%q body=%q", gotAPIKey, gotType, gotUpsert, gotBody)
	}
	// New-style sb_secret_ keys are not JWTs and must not be sent as a Bearer token.
	if gotAuth != "" {
		t.Fatalf("Authorization = %q, want empty for sb_secret_ key", gotAuth)
	}
}

func TestClient_LegacyJWTKeyAlsoSentAsBearer(t *testing.T) {
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := New(server.URL, "eyJhbGciOiJIUzI1NiJ9.e30.sig", "expense-receipts", server.Client())
	if err := client.Delete(context.Background(), "receipts/r1/abc.png"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if gotAuth != "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig" {
		t.Fatalf("Authorization = %q", gotAuth)
	}
}

func TestClient_UploadReportsHTTPErrorWithoutKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"Bucket not found"}`, http.StatusBadRequest)
	}))
	defer server.Close()

	client := New(server.URL, "sb_secret_hidden", "expense-receipts", server.Client())
	err := client.Upload(context.Background(), "receipts/r1/abc.png", "image/png", []byte("x"))
	if err == nil {
		t.Fatal("Upload err = nil, want error")
	}
	if strings.Contains(err.Error(), "sb_secret_hidden") {
		t.Fatalf("error leaks key: %v", err)
	}
}

func TestClient_DeleteMapsMissingObjectToErrNotFound(t *testing.T) {
	var gotMethod, gotPath string
	responses := []struct {
		status int
		body   string
	}{
		{http.StatusNotFound, `{"error":"not_found"}`},
		{http.StatusBadRequest, `{"statusCode":"404","error":"not_found","message":"Object not found"}`},
	}
	for _, resp := range responses {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotMethod, gotPath = r.Method, r.URL.EscapedPath()
			w.WriteHeader(resp.status)
			_, _ = w.Write([]byte(resp.body))
		}))
		client := New(server.URL, "sb_secret_test", "expense-receipts", server.Client())
		err := client.Delete(context.Background(), "receipts/r1/abc.png")
		server.Close()
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("status %d: err = %v, want ErrNotFound", resp.status, err)
		}
		if gotMethod != http.MethodDelete || gotPath != "/storage/v1/object/expense-receipts/receipts/r1/abc.png" {
			t.Errorf("request = %s %s", gotMethod, gotPath)
		}
	}
}

func TestClient_SignedURLRequestsExpiryAndReturnsAbsoluteURL(t *testing.T) {
	var gotPath string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.EscapedPath()
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/expense-receipts/receipts/r1/abc.png?token=tok"}`))
	}))
	defer server.Close()

	client := New(server.URL, "sb_secret_test", "expense-receipts", server.Client())
	url, err := client.SignedURL(context.Background(), "receipts/r1/abc.png", 5*time.Minute)
	if err != nil {
		t.Fatalf("SignedURL: %v", err)
	}
	if gotPath != "/storage/v1/object/sign/expense-receipts/receipts/r1/abc.png" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotBody["expiresIn"] != float64(300) {
		t.Fatalf("body = %v, want expiresIn 300", gotBody)
	}
	if url != server.URL+"/storage/v1/object/sign/expense-receipts/receipts/r1/abc.png?token=tok" {
		t.Fatalf("url = %q", url)
	}
}

func TestClient_SignedURLMissingObject(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"statusCode":"404","error":"not_found","message":"Object not found"}`))
	}))
	defer server.Close()

	client := New(server.URL, "sb_secret_test", "expense-receipts", server.Client())
	if _, err := client.SignedURL(context.Background(), "receipts/r1/abc.png", 5*time.Minute); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}
