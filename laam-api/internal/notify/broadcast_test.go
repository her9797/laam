package notify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBroadcaster_Send_SkipsWhenNotConfigured(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	t.Run("empty broadcast key", func(t *testing.T) {
		b := NewBroadcaster(server.URL, "")
		if err := b.Send(context.Background(), "admin-requests", "new_request", map[string]string{"type": "new_request"}); err != nil {
			t.Errorf("Send() error = %v, want nil (should skip silently)", err)
		}
	})

	t.Run("empty Supabase URL", func(t *testing.T) {
		b := NewBroadcaster("", "some-key")
		if err := b.Send(context.Background(), "admin-requests", "new_request", map[string]string{"type": "new_request"}); err != nil {
			t.Errorf("Send() error = %v, want nil (should skip silently)", err)
		}
	})

	if calls != 0 {
		t.Errorf("server received %d requests, want 0 (Send should not call out when not configured)", calls)
	}
}

func TestBroadcaster_Send_PostsToTheBroadcastEndpoint(t *testing.T) {
	var (
		gotPath   string
		gotAPIKey string
		gotBody   map[string]string
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAPIKey = r.Header.Get("apikey")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	b := NewBroadcaster(server.URL, "test-broadcast-key")
	err := b.Send(context.Background(), "admin-requests", "new_request", map[string]string{"type": "new_request"})
	if err != nil {
		t.Fatalf("Send() error = %v", err)
	}

	if gotPath != "/realtime/v1/api/broadcast/admin-requests/events/new_request" {
		t.Errorf("path = %q, want the topic/event broadcast path", gotPath)
	}
	if gotAPIKey != "test-broadcast-key" {
		t.Errorf("apikey header = %q, want the configured broadcast key", gotAPIKey)
	}
	if gotBody["type"] != "new_request" {
		t.Errorf("body = %+v, want payload to be posted as-is", gotBody)
	}
}

func TestBroadcaster_Send_ReturnsErrorOnNonSuccessStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	b := NewBroadcaster(server.URL, "test-broadcast-key")
	err := b.Send(context.Background(), "admin-requests", "new_request", map[string]string{"type": "new_request"})
	if err == nil {
		t.Fatal("Send() error = nil, want an error for a non-2xx response")
	}
}

// TestBroadcaster_Send_PostsNewOrderEventToTheOrdersTopic pins the
// order-notification half of the cross-language channel contract: these
// constants have no shared source of truth with laam-admin-web's
// useOrderBroadcast.ts, so a rename here would otherwise break the admin
// client silently.
func TestBroadcaster_Send_PostsNewOrderEventToTheOrdersTopic(t *testing.T) {
	var (
		gotPath string
		gotBody map[string]string
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	b := NewBroadcaster(server.URL, "test-broadcast-key")
	if err := b.Send(context.Background(), OrdersTopic, NewOrderEvent, NewOrderPayload{Type: NewOrderEvent}); err != nil {
		t.Fatalf("Send() error = %v", err)
	}

	if gotPath != "/realtime/v1/api/broadcast/admin-orders/events/new_order" {
		t.Errorf("path = %q, want the admin-orders/new_order broadcast path", gotPath)
	}
	if gotBody["type"] != "new_order" {
		t.Errorf("body = %+v, want a content-free {\"type\":\"new_order\"} signal", gotBody)
	}
}
