package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func seedSystemErrorLogViaSQL(t *testing.T, id string, method string, path string, status int, message string, createdAt time.Time) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO system_error_logs (id, method, path, status, message, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, method, path, status, message, createdAt)
	if err != nil {
		t.Fatalf("seed system_error_logs %q: %v", id, err)
	}
}

func countSystemErrorLogs(t *testing.T) int {
	t.Helper()
	var count int
	if err := testPool.QueryRow(context.Background(), `SELECT COUNT(*) FROM system_error_logs`).Scan(&count); err != nil {
		t.Fatalf("count system_error_logs: %v", err)
	}
	return count
}

func TestSystemLogMiddleware_RecoversPanicAndRecordsLog(t *testing.T) {
	resetServer(t)

	panicking := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	})
	handler := systemLogMiddleware(panicking, testRepo)

	rec := doRequest(t, handler, http.MethodGet, "/whatever", nil, nil)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if strings.Contains(body["error"], "boom") {
		t.Errorf("response body leaked panic detail: %q", body["error"])
	}
	if body["error"] == "" {
		t.Error("expected a generic error message in the response body")
	}

	if count := countSystemErrorLogs(t); count != 1 {
		t.Fatalf("system_error_logs count = %d, want 1", count)
	}
}

func TestSystemLogMiddleware_RecordsNormal5xxFromWriteError(t *testing.T) {
	resetServer(t)

	failing := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusInternalServerError, errors.New("db unavailable"))
	})
	handler := systemLogMiddleware(failing, testRepo)

	rec := doRequest(t, handler, http.MethodGet, "/whatever", nil, nil)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}

	items, total, err := testRepo.ListSystemErrorLogs(context.Background(), 1, 20)
	if err != nil {
		t.Fatalf("ListSystemErrorLogs() error = %v", err)
	}
	if total != 1 || len(items) != 1 {
		t.Fatalf("total = %d, len(items) = %d, want 1 and 1", total, len(items))
	}
	if items[0].Status != http.StatusInternalServerError || items[0].Message != "db unavailable" {
		t.Errorf("item = %+v, want status=500 message=%q", items[0], "db unavailable")
	}
}

func TestSystemLogMiddleware_DoesNotRecordNon5xxResponses(t *testing.T) {
	resetServer(t)

	badRequest := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusBadRequest, errors.New("bad input"))
	})
	notFound := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	rec := doRequest(t, systemLogMiddleware(badRequest, testRepo), http.MethodGet, "/whatever", nil, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	rec = doRequest(t, systemLogMiddleware(notFound, testRepo), http.MethodGet, "/whatever", nil, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}

	if count := countSystemErrorLogs(t); count != 0 {
		t.Fatalf("system_error_logs count = %d, want 0", count)
	}
}

func TestSystemLogMiddleware_DoesNotRecordSuccessOrRedirectResponses(t *testing.T) {
	resetServer(t)

	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	redirect := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/elsewhere", http.StatusFound)
	})

	rec := doRequest(t, systemLogMiddleware(ok, testRepo), http.MethodGet, "/whatever", nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	rec = doRequest(t, systemLogMiddleware(redirect, testRepo), http.MethodGet, "/whatever", nil, nil)
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
	}

	if count := countSystemErrorLogs(t); count != 0 {
		t.Fatalf("system_error_logs count = %d, want 0", count)
	}
}

func TestSystemLogMiddleware_PanicAfterHeaderWritten_DoesNotWriteHeaderAgain(t *testing.T) {
	resetServer(t)

	panicking := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		panic("boom after header")
	})
	handler := systemLogMiddleware(panicking, testRepo)

	rec := doRequest(t, handler, http.MethodGet, "/whatever", nil, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (writeError must not overwrite a header already sent)", rec.Code, http.StatusOK)
	}

	if count := countSystemErrorLogs(t); count != 1 {
		t.Fatalf("system_error_logs count = %d, want 1", count)
	}
}

func TestSystemLogMiddleware_RepositoryErrorDoesNotAffectResponse(t *testing.T) {
	resetServer(t)

	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `ALTER TABLE system_error_logs RENAME TO system_error_logs_missing_for_test`); err != nil {
		t.Fatalf("rename system_error_logs: %v", err)
	}
	defer func() {
		if _, err := testPool.Exec(ctx, `ALTER TABLE system_error_logs_missing_for_test RENAME TO system_error_logs`); err != nil {
			t.Fatalf("restore system_error_logs: %v", err)
		}
	}()

	failing := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusInternalServerError, errors.New("db unavailable"))
	})
	handler := systemLogMiddleware(failing, testRepo)

	rec := doRequest(t, handler, http.MethodGet, "/whatever", nil, nil)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != "db unavailable" {
		t.Errorf("body[error] = %q, want %q", body["error"], "db unavailable")
	}
}

func TestRouter_AdminSystemLogs_RequiresAdminAuth(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/system-logs", nil, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestRouter_AdminSystemLogs_RejectsNonGet(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/system-logs", nil, adminHeaders())
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusMethodNotAllowed, rec.Body.String())
	}
}

func TestRouter_AdminSystemLogs_ReturnsPaginatedEnvelope(t *testing.T) {
	handler := resetServer(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	seedSystemErrorLogViaSQL(t, "log-1", "GET", "/api/v1/menu", 500, "boom 1", base)
	seedSystemErrorLogViaSQL(t, "log-2", "POST", "/api/v1/admin/payment-orders", 502, "boom 2", base.Add(time.Hour))

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/system-logs", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope struct {
		Items []struct {
			ID      string `json:"id"`
			Method  string `json:"method"`
			Path    string `json:"path"`
			Status  int    `json:"status"`
			Message string `json:"message"`
		} `json:"items"`
		Page     int `json:"page"`
		PageSize int `json:"pageSize"`
		Total    int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v (body = %s)", err, rec.Body.String())
	}
	if envelope.Total != 2 || len(envelope.Items) != 2 || envelope.Page != 1 || envelope.PageSize != 20 {
		t.Fatalf("envelope = %+v, want total=2 items=2 page=1 pageSize=20", envelope)
	}
	if envelope.Items[0].Path != "/api/v1/admin/payment-orders" {
		t.Errorf("items[0].Path = %q, want newest first (/api/v1/admin/payment-orders)", envelope.Items[0].Path)
	}
}
