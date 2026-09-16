package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestRouter_AdminCustomerRequestPendingSummary(t *testing.T) {
	handler := resetServer(t)
	createCustomerRequestViaAPI(t, handler, "T-01", "napkins please")
	time.Sleep(2 * time.Millisecond)
	createCustomerRequestViaAPI(t, handler, "T-02", "[노래 신청] Dynamite")

	t.Run("requires auth", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests/pending-summary", nil, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("only GET is allowed", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/customer-requests/pending-summary", nil, adminHeaders())
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("returns pending counts by kind and newest pending items", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests/pending-summary", nil, adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}

		var body struct {
			PendingGeneralCount int `json:"pendingGeneralCount"`
			PendingSongCount    int `json:"pendingSongCount"`
			Items               []struct {
				TableNumber string `json:"tableNumber"`
				Status      string `json:"status"`
			} `json:"items"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v (body = %s)", err, rec.Body.String())
		}
		if body.PendingGeneralCount != 1 || body.PendingSongCount != 1 {
			t.Errorf("counts = (general %d, song %d), want (1, 1)", body.PendingGeneralCount, body.PendingSongCount)
		}
		if len(body.Items) != 2 || body.Items[0].TableNumber != "T-02" || body.Items[1].TableNumber != "T-01" {
			t.Errorf("items = %+v, want [T-02, T-01]", body.Items)
		}
	})
}

func TestRouter_AdminSpecialRequestDelete_ReturnsNoContent(t *testing.T) {
	handler := resetServer(t)
	createSpecialRequestViaAPI(t, handler, "T-01", "Kim")

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/special-requests", nil, adminHeaders())
	var requests []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &requests); err != nil || len(requests) != 1 {
		t.Fatalf("list = %s (err %v), want a single request", rec.Body.String(), err)
	}

	rec = doRequest(t, handler, http.MethodDelete, "/api/v1/admin/special-requests/"+requests[0].ID, nil, adminHeaders())
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusNoContent, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("body = %q, want empty", rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodDelete, "/api/v1/admin/special-requests/"+requests[0].ID, nil, adminHeaders())
	if rec.Code != http.StatusNotFound {
		t.Errorf("second delete status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}
