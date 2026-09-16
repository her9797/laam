package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/her9797/laam/laam-api/internal/store"
)

func TestParseResourceID(t *testing.T) {
	cases := []struct {
		name   string
		path   string
		prefix string
		wantID string
		wantOK bool
	}{
		{"simple id", "/api/v1/admin/categories/food", "/api/v1/admin/categories/", "food", true},
		{"trailing slash is trimmed", "/api/v1/admin/categories/food/", "/api/v1/admin/categories/", "food", true},
		{"missing prefix fails", "/other/path", "/api/v1/admin/categories/", "", false},
		{"empty id fails", "/api/v1/admin/categories/", "/api/v1/admin/categories/", "", false},
		{"nested path fails", "/api/v1/admin/categories/food/extra", "/api/v1/admin/categories/", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, ok := parseResourceID(tc.path, tc.prefix)
			if id != tc.wantID || ok != tc.wantOK {
				t.Errorf("parseResourceID(%q, %q) = (%q, %v), want (%q, %v)", tc.path, tc.prefix, id, ok, tc.wantID, tc.wantOK)
			}
		})
	}
}

func TestParseVisibilityResourceID(t *testing.T) {
	cases := []struct {
		name   string
		path   string
		prefix string
		wantID string
		wantOK bool
	}{
		{"valid visibility path", "/api/v1/admin/categories/food/visibility", "/api/v1/admin/categories/", "food", true},
		{"missing visibility suffix fails", "/api/v1/admin/categories/food", "/api/v1/admin/categories/", "", false},
		{"empty id fails", "/api/v1/admin/categories//visibility", "/api/v1/admin/categories/", "", false},
		{"missing prefix fails", "/other/path/visibility", "/api/v1/admin/categories/", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, ok := parseVisibilityResourceID(tc.path, tc.prefix)
			if id != tc.wantID || ok != tc.wantOK {
				t.Errorf("parseVisibilityResourceID(%q, %q) = (%q, %v), want (%q, %v)", tc.path, tc.prefix, id, ok, tc.wantID, tc.wantOK)
			}
		})
	}
}

func TestParseStatusResourceID(t *testing.T) {
	cases := []struct {
		name   string
		path   string
		prefix string
		wantID string
		wantOK bool
	}{
		{"valid status path", "/api/v1/admin/customer-requests/req-1/status", "/api/v1/admin/customer-requests/", "req-1", true},
		{"missing status suffix fails", "/api/v1/admin/customer-requests/req-1", "/api/v1/admin/customer-requests/", "", false},
		{"empty id fails", "/api/v1/admin/customer-requests//status", "/api/v1/admin/customer-requests/", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, ok := parseStatusResourceID(tc.path, tc.prefix)
			if id != tc.wantID || ok != tc.wantOK {
				t.Errorf("parseStatusResourceID(%q, %q) = (%q, %v), want (%q, %v)", tc.path, tc.prefix, id, ok, tc.wantID, tc.wantOK)
			}
		})
	}
}

func TestStoreInputSpecialRequest_TrimsWhitespace(t *testing.T) {
	payload := createSpecialRequestRequest{
		TableNumber: "  T-01  ",
		Gender:      " male ",
		Name:        " 홍길동 ",
		Age:         " 20s ",
		Residence:   " 서울 ",
		Instagram:   " @handle ",
		IdealType:   " tall ",
		Text:        " hello ",
	}

	got := storeInputSpecialRequest(payload)

	if got.TableNumber != "T-01" || got.Gender != "male" || got.Name != "홍길동" ||
		got.Age != "20s" || got.Residence != "서울" || got.Instagram != "@handle" ||
		got.IdealType != "tall" || got.Text != "hello" {
		t.Errorf("storeInputSpecialRequest did not trim all fields: %+v", got)
	}
}

func TestWithCORS_OptionsRequestShortCircuits(t *testing.T) {
	called := false
	handler := withCORS("https://example.com", func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/menu", nil)
	rec := httptest.NewRecorder()

	handler(rec, req)

	if called {
		t.Error("next handler should not be called for OPTIONS requests")
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://example.com" {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, "https://example.com")
	}
}

func TestWithCORS_NonOptionsCallsNextAndSetsHeaders(t *testing.T) {
	called := false
	handler := withCORS("*", func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/menu", nil)
	rec := httptest.NewRecorder()

	handler(rec, req)

	if !called {
		t.Error("next handler should be called for non-OPTIONS requests")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, "*")
	}
}

func TestRequireAdminAuth(t *testing.T) {
	t.Run("valid bearer token passes", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/categories", nil)
		req.Header.Set("Authorization", "Bearer secret-token")
		rec := httptest.NewRecorder()

		if ok := requireAdminAuth(rec, req, "secret-token"); !ok {
			t.Error("requireAdminAuth() = false, want true for matching token")
		}
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want default %d (no response should be written)", rec.Code, http.StatusOK)
		}
	})

	t.Run("missing header is rejected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/categories", nil)
		rec := httptest.NewRecorder()

		if ok := requireAdminAuth(rec, req, "secret-token"); ok {
			t.Error("requireAdminAuth() = true, want false when Authorization header is missing")
		}
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("wrong token is rejected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/categories", nil)
		req.Header.Set("Authorization", "Bearer wrong-token")
		rec := httptest.NewRecorder()

		if ok := requireAdminAuth(rec, req, "secret-token"); ok {
			t.Error("requireAdminAuth() = true, want false for mismatched token")
		}
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})
}

func TestWriteStoreError(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{"invalid input maps to 400", store.ErrInvalidInput, http.StatusBadRequest},
		{"already exists maps to 409", store.ErrAlreadyExists, http.StatusConflict},
		{"not found maps to 404", store.ErrNotFound, http.StatusNotFound},
		{"unknown error maps to 500", errors.New("boom"), http.StatusInternalServerError},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeStoreError(rec, tc.err)

			if rec.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
		})
	}
}

func TestWriteJSON(t *testing.T) {
	rec := httptest.NewRecorder()

	writeJSON(rec, http.StatusCreated, map[string]string{"status": "ok"})

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want %q", got, "application/json; charset=utf-8")
	}
	if got := rec.Body.String(); got != "{\"status\":\"ok\"}\n" {
		t.Errorf("body = %q, want %q", got, "{\"status\":\"ok\"}\n")
	}
}

func TestWriteMethodNotAllowed(t *testing.T) {
	rec := httptest.NewRecorder()

	writeMethodNotAllowed(rec)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
