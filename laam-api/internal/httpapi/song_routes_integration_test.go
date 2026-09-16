package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/lamdata"
)

func TestRouter_SongApprovalAndPlaybackQueue(t *testing.T) {
	var searchQuery url.Values
	youtubeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		searchQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":{"videoId":"video-123"},"snippet":{"title":"NewJeans - Ditto","channelTitle":"HYBE LABELS"}}]}`))
	}))
	defer youtubeServer.Close()

	cfg := config.Config{
		AllowedOrigin:     "*",
		AdminAPIToken:     testCfg.AdminAPIToken,
		PaymentAPIToken:   testCfg.PaymentAPIToken,
		YouTubeAPIKey:     "youtube-test-key",
		YouTubeAPIBaseURL: youtubeServer.URL,
	}
	handler := resetServerWithConfig(t, cfg)

	requestBody, _ := json.Marshal(map[string]string{
		"tableNumber": "T-02",
		"text":        "[노래 신청] Ditto - NewJeans",
	})
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/customer-requests", requestBody, requestHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("create request status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests?kind=song", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("list requests status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var page lamdata.CustomerRequestPage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Items) != 1 {
		t.Fatalf("decode requests error = %v, body = %s", err, rec.Body.String())
	}
	requestID := page.Items[0].ID

	t.Run("approval requires admin auth", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/song-requests/"+requestID+"/approve", nil, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/song-requests/"+requestID+"/approve", nil, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("approve status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var queued lamdata.SongQueueItem
	if err := json.Unmarshal(rec.Body.Bytes(), &queued); err != nil {
		t.Fatalf("decode approved queue item: %v", err)
	}
	if queued.YouTubeVideoID != "video-123" || queued.Status != "queued" || queued.TableNumber != "T-02" {
		t.Fatalf("approved queue item = %+v", queued)
	}
	if searchQuery.Get("q") != "Ditto - NewJeans official audio" {
		t.Fatalf("YouTube search query = %q", searchQuery.Get("q"))
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/song-player/queue", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("queue status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var queue []lamdata.SongQueueItem
	if err := json.Unmarshal(rec.Body.Bytes(), &queue); err != nil || len(queue) != 1 {
		t.Fatalf("decode queue error = %v, body = %s", err, rec.Body.String())
	}

	statusBody, _ := json.Marshal(map[string]string{"status": "playing"})
	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/song-player/queue/"+queued.ID+"/status", statusBody, adminHeaders())
	if rec.Code != http.StatusNoContent {
		t.Fatalf("playing status = %d, body = %s", rec.Code, rec.Body.String())
	}

	statusBody, _ = json.Marshal(map[string]string{"status": "completed"})
	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/song-player/queue/"+queued.ID+"/status", statusBody, adminHeaders())
	if rec.Code != http.StatusNoContent {
		t.Fatalf("completed status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/song-player/queue", nil, adminHeaders())
	if rec.Code != http.StatusOK || rec.Body.String() != "[]\n" {
		t.Fatalf("completed queue status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestRouter_SongApprovalRequiresYouTubeConfiguration(t *testing.T) {
	handler := resetServer(t)
	requestBody, _ := json.Marshal(map[string]string{
		"tableNumber": "T-02",
		"text":        "[노래 신청] Ditto - NewJeans",
	})
	_ = doRequest(t, handler, http.MethodPost, "/api/v1/customer-requests", requestBody, requestHeaders())
	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests?kind=song", nil, adminHeaders())
	var page lamdata.CustomerRequestPage
	_ = json.Unmarshal(rec.Body.Bytes(), &page)

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/song-requests/"+page.Items[0].ID+"/approve", nil, adminHeaders())
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
}
