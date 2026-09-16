package youtube

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestClientSearchFindsFirstEmbeddableVideo(t *testing.T) {
	var query url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":{"videoId":"video-123"},"snippet":{"title":"Official &amp; Song","channelTitle":"Artist &amp; Channel"}}]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "api-key", server.Client())
	video, err := client.Search(context.Background(), "Song Artist")
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if video.ID != "video-123" || video.Title != "Official & Song" || video.ChannelTitle != "Artist & Channel" {
		t.Fatalf("Search() = %+v", video)
	}
	if query.Get("q") != "Song Artist official audio" || query.Get("type") != "video" || query.Get("videoEmbeddable") != "true" || query.Get("videoSyndicated") != "true" || query.Get("key") != "api-key" {
		t.Fatalf("query = %v", query)
	}
}

func TestClientSearchRequiresConfiguration(t *testing.T) {
	client := NewClient("https://example.com", "", nil)
	if _, err := client.Search(context.Background(), "Song"); err != ErrNotConfigured {
		t.Fatalf("Search() error = %v, want ErrNotConfigured", err)
	}
}

func TestClientSearchRejectsEmptyResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "api-key", server.Client())
	if _, err := client.Search(context.Background(), "missing"); err != ErrNoResults {
		t.Fatalf("Search() error = %v, want ErrNoResults", err)
	}
}
