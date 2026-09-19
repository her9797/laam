package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"testing"

	"github.com/her9797/laam/laam-api/internal/config"
)

func expectedQrSignature(secret, id string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(id))
	return hex.EncodeToString(mac.Sum(nil))
}

func tablesTestConfig() config.Config {
	return config.Config{
		AllowedOrigin:      "*",
		AdminAPIToken:      "test-admin-token",
		QRSigningSecret:    "test-qr-signing-secret",
		CustomerWebBaseURL: "https://example.test",
	}
}

func TestRouter_AdminTables_RequiresAdminAuth(t *testing.T) {
	handler := NewMux(nil, tablesTestConfig(), nil)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables", nil, nil)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

// The listing itself now comes from qr_tables, so its contents are covered
// by table_link_router_integration_test.go against a real database. What is
// left here are the checks that run before the store is ever touched.

func TestRouter_AdminTables_MissingQrConfig(t *testing.T) {
	cases := []struct {
		name string
		cfg  config.Config
	}{
		{"missing signing secret", config.Config{AllowedOrigin: "*", AdminAPIToken: "test-admin-token", CustomerWebBaseURL: "https://example.test"}},
		{"missing customer web base url", config.Config{AllowedOrigin: "*", AdminAPIToken: "test-admin-token", QRSigningSecret: "test-qr-signing-secret"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handler := NewMux(nil, tc.cfg, nil)
			rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables", nil, map[string]string{"Authorization": "Bearer test-admin-token"})
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
			}
		})
	}
}
