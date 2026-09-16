package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

func TestRouter_AdminTables_ReturnsTablesInOrderWithSignature(t *testing.T) {
	cfg := tablesTestConfig()
	handler := NewMux(nil, cfg, nil)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables", nil, adminHeaders())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body struct {
		Tables []struct {
			ID     string `json:"id"`
			Area   string `json:"area"`
			Number int    `json:"number"`
			QrURL  string `json:"qrUrl"`
		} `json:"tables"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v, body = %s", err, rec.Body.String())
	}

	wantIDs := []string{
		"B-01", "B-02", "B-03", "B-04", "B-05",
		"T-01", "T-02", "T-03", "T-04", "T-05",
		"T-06", "T-07", "T-08", "T-09", "T-10",
	}
	if len(body.Tables) != len(wantIDs) {
		t.Fatalf("got %d tables, want %d", len(body.Tables), len(wantIDs))
	}

	for i, wantID := range wantIDs {
		got := body.Tables[i]
		if got.ID != wantID {
			t.Errorf("tables[%d].id = %q, want %q", i, got.ID, wantID)
		}

		wantSig := expectedQrSignature(cfg.QRSigningSecret, wantID)
		if got.QrURL == "" {
			t.Fatalf("tables[%d].qrUrl is empty", i)
		}
		wantURL := cfg.CustomerWebBaseURL + "/qr/enter?table=" + wantID + "&sig=" + wantSig
		if got.QrURL != wantURL {
			t.Errorf("tables[%d].qrUrl = %q, want %q", i, got.QrURL, wantURL)
		}
	}
}

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
