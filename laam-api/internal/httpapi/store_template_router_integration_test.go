package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
)

const storeTemplatePath = "/api/v1/admin/store-template"
const storeTemplatePreviewPath = "/api/v1/admin/store-template/preview"

func storeTemplateConfig() config.Config {
	cfg := testCfg
	cfg.QRSigningSecret = "test-qr-signing-secret"
	cfg.CustomerWebBaseURL = "https://example.test"
	return cfg
}

func currentCustomerTemplate(t *testing.T, handler http.Handler) string {
	t.Helper()
	rec := doRequest(t, handler, http.MethodGet, "/api/v1/bootstrap", nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("bootstrap status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Store struct {
			CustomerTemplate string `json:"customerTemplate"`
		} `json:"store"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode bootstrap: %v", err)
	}
	return body.Store.CustomerTemplate
}

func TestRouter_Bootstrap_DefaultCustomerTemplate(t *testing.T) {
	handler := resetServerWithConfig(t, storeTemplateConfig())

	if got := currentCustomerTemplate(t, handler); got != "classic" {
		t.Errorf("store.customerTemplate = %q, want %q", got, "classic")
	}
}

func TestRouter_AdminStoreTemplate_Update(t *testing.T) {
	handler := resetServerWithConfig(t, storeTemplateConfig())

	t.Run("without auth is rejected", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPatch, storeTemplatePath, []byte(`{"template":"notebook"}`), nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
		rec = doRequest(t, handler, http.MethodPatch, storeTemplatePath, []byte(`{"template":"notebook"}`), map[string]string{"Authorization": "Bearer wrong"})
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("wrong token status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("wrong method is rejected", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPost, storeTemplatePath, []byte(`{"template":"notebook"}`), adminHeaders())
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("valid template returns updated bootstrap", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPatch, storeTemplatePath, []byte(`{"template":" notebook "}`), adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
		var body struct {
			Store struct {
				CustomerTemplate string `json:"customerTemplate"`
			} `json:"store"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body.Store.CustomerTemplate != "notebook" {
			t.Errorf("response store.customerTemplate = %q, want %q", body.Store.CustomerTemplate, "notebook")
		}
		if got := currentCustomerTemplate(t, handler); got != "notebook" {
			t.Errorf("bootstrap store.customerTemplate = %q, want %q", got, "notebook")
		}
	})

	for _, tc := range []struct {
		name string
		body string
	}{
		{"unknown template", `{"template":"neon"}`},
		{"empty template", `{"template":""}`},
		{"missing template", `{}`},
		{"invalid json", `{"template":`},
	} {
		t.Run(tc.name+" is rejected", func(t *testing.T) {
			rec := doRequest(t, handler, http.MethodPatch, storeTemplatePath, []byte(tc.body), adminHeaders())
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
			if got := currentCustomerTemplate(t, handler); got != "notebook" {
				t.Errorf("store.customerTemplate = %q after rejected update, want unchanged %q", got, "notebook")
			}
		})
	}
}

func TestRouter_AdminStoreTemplate_Preview(t *testing.T) {
	cfg := storeTemplateConfig()
	handler := resetServerWithConfig(t, cfg)

	t.Run("without auth is rejected", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPost, storeTemplatePreviewPath, []byte(`{"template":"chalkboard"}`), nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("wrong method is rejected", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, storeTemplatePreviewPath, nil, adminHeaders())
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("valid template returns a signed preview url", func(t *testing.T) {
		before := time.Now().Unix()
		rec := doRequest(t, handler, http.MethodPost, storeTemplatePreviewPath, []byte(`{"template":"chalkboard"}`), adminHeaders())
		after := time.Now().Unix()
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
		var body struct {
			URL string `json:"url"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		parsed, err := url.Parse(body.URL)
		if err != nil {
			t.Fatalf("parse url %q: %v", body.URL, err)
		}
		if got := parsed.Scheme + "://" + parsed.Host + parsed.Path; got != "https://example.test/preview/enter" {
			t.Errorf("url base = %q, want %q", got, "https://example.test/preview/enter")
		}
		query := parsed.Query()
		if query.Get("template") != "chalkboard" {
			t.Errorf("template = %q, want %q", query.Get("template"), "chalkboard")
		}
		exp, err := strconv.ParseInt(query.Get("exp"), 10, 64)
		if err != nil {
			t.Fatalf("exp %q is not unix seconds: %v", query.Get("exp"), err)
		}
		ttl := int64((30 * time.Minute).Seconds())
		if exp < before+ttl || exp > after+ttl {
			t.Errorf("exp = %d, want now+%ds (between %d and %d)", exp, ttl, before+ttl, after+ttl)
		}
		wantSig := expectedQrSignature(cfg.QRSigningSecret, "preview:chalkboard:"+query.Get("exp"))
		if query.Get("sig") != wantSig {
			t.Errorf("sig = %q, want %q", query.Get("sig"), wantSig)
		}
	})

	for _, tc := range []struct {
		name string
		body string
	}{
		{"unknown template", `{"template":"neon"}`},
		{"empty template", `{"template":""}`},
		{"invalid json", `{"template":`},
	} {
		t.Run(tc.name+" is rejected", func(t *testing.T) {
			rec := doRequest(t, handler, http.MethodPost, storeTemplatePreviewPath, []byte(tc.body), adminHeaders())
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}

	t.Run("missing qr config is a server error", func(t *testing.T) {
		missing := resetServerWithConfig(t, testCfg)
		rec := doRequest(t, missing, http.MethodPost, storeTemplatePreviewPath, []byte(`{"template":"chalkboard"}`), adminHeaders())
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
		}
	})
}
