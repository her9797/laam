package tossplace

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Only a JSON array, or an object that actually carries a payments array,
// is a payment list. Anything else must not read as "no payments", or a
// paid bill would be marked fully synced with nothing recorded.
func TestClientGetPaymentsByOrderIDRejectsUnknownShapes(t *testing.T) {
	for name, success := range map[string]string{
		"null":                 `null`,
		"object without key":   `{"items":[]}`,
		"null payments":        `{"payments":null}`,
		"non-array payments":   `{"payments":{}}`,
		"string":               `"none"`,
		"empty object":         `{}`,
		"missing success body": ``,
	} {
		t.Run(name, func(t *testing.T) {
			body := `{"resultType":"SUCCESS"}`
			if success != "" {
				body = `{"resultType":"SUCCESS","success":` + success + `}`
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()

			client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
			payments, err := client.GetPaymentsByOrderID(context.Background(), "pos-order-9")
			if err == nil {
				t.Fatalf("GetPaymentsByOrderID() = %+v, nil; want an error for success %s", payments, success)
			}
		})
	}
}

func TestClientGetPaymentsByOrderIDAcceptsEmptyLists(t *testing.T) {
	for _, success := range []string{`[]`, `{"payments":[]}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":` + success + `}`))
		}))
		client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
		payments, err := client.GetPaymentsByOrderID(context.Background(), "pos-order-9")
		server.Close()
		if err != nil || len(payments) != 0 {
			t.Fatalf("success %s: payments = %+v err = %v, want an empty list", success, payments, err)
		}
	}
}
