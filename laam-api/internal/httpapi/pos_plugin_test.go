package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/her9797/laam/laam-api/internal/config"
)

func TestPOSPluginDiagnostics(t *testing.T) {
	mux := http.NewServeMux()
	registerPOSPluginRoutes(mux, nil, config.Config{AllowedOrigin: "*"}, nil)

	t.Run("accepts an unauthenticated crash report", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/pos-plugin/diagnostics",
			strings.NewReader(`{"stage":"sdk-import","message":"ReferenceError: self is not defined"}`))
		rec := httptest.NewRecorder()

		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
	})

	t.Run("rejects non-POST requests", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/pos-plugin/diagnostics", nil)
		rec := httptest.NewRecorder()

		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("rejects invalid JSON", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/pos-plugin/diagnostics", strings.NewReader("not json"))
		rec := httptest.NewRecorder()

		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
		}
	})
}

func TestPOSPluginClaimIsDisabledForOpenAPIProvider(t *testing.T) {
	mux := http.NewServeMux()
	registerPOSPluginRoutes(mux, nil, config.Config{
		AllowedOrigin:     "*",
		POSOrderProvider:  "open-api",
		POSPluginAPIToken: "plugin-token",
	}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/pos-plugin/orders/claim", nil)
	req.Header.Set("Authorization", "Bearer plugin-token")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}
