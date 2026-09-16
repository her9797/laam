package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/her9797/laam/laam-api/internal/catalogsync"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

// fakeSyncCatalogClient is a minimal catalogsync client stub — it only
// needs to satisfy catalogsync's unexported catalogClient interface
// (ListCatalogItems), which Go's structural typing allows from any
// package.
type fakeSyncCatalogClient struct {
	items []tossplace.CatalogItem
	err   error
}

func (f *fakeSyncCatalogClient) ListCatalogItems(context.Context) ([]tossplace.CatalogItem, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.items, nil
}

func resetServerWithSyncer(t *testing.T, syncer *catalogsync.Syncer) http.Handler {
	t.Helper()
	resetServer(t) // truncates tables and seeds store_profile; discard its own (nil-syncer) handler
	return NewMux(testRepo, testCfg, syncer)
}

func TestRouter_AdminCatalogSync_RequiresAdminAuth(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/catalog-sync", nil, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestRouter_AdminCatalogSync_RejectsNonPost(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/catalog-sync", nil, adminHeaders())
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusMethodNotAllowed, rec.Body.String())
	}
}

func TestRouter_AdminCatalogSync_ReturnsServiceUnavailableWhenNotConfigured(t *testing.T) {
	// resetServer wires NewMux with a nil syncer — Toss Place is
	// unconfigured in every other test's shared testCfg on purpose (see
	// TestRouter_PaymentConfirm_SendsNewOrderBroadcast's own doc comment
	// for the same pattern applied to Supabase).
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/catalog-sync", nil, adminHeaders())
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
}

func TestRouter_AdminCatalogSync_ReturnsCountsAndBootstrapDataOnSuccess(t *testing.T) {
	client := &fakeSyncCatalogClient{items: []tossplace.CatalogItem{
		{
			ID:       "item-1",
			Title:    "테스트 하이볼",
			Category: tossplace.CatalogCategory{Title: "1%~7%"},
			Price:    tossplace.CatalogPrice{Type: "FIXED", Value: 9000},
			State:    "ON_SALE",
			Enabled:  true,
		},
	}}
	syncer := catalogsync.New(client, testRepo)
	handler := resetServerWithSyncer(t, syncer)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/catalog-sync", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var response struct {
		Created int `json:"created"`
		Linked  int `json:"linked"`
		Updated int `json:"updated"`
		Data    struct {
			Items []struct {
				Name string `json:"name"`
			} `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v (body = %s)", err, rec.Body.String())
	}
	if response.Created != 1 {
		t.Errorf("Created = %d, want 1", response.Created)
	}
	if len(response.Data.Items) != 1 || response.Data.Items[0].Name != "테스트 하이볼" {
		t.Errorf("Data.Items = %+v, want a single synced item", response.Data.Items)
	}
}

func TestRouter_AdminCatalogSync_ReturnsBadGatewayWhenPOSCallFails(t *testing.T) {
	client := &fakeSyncCatalogClient{err: errors.New("toss place unreachable")}
	syncer := catalogsync.New(client, testRepo)
	handler := resetServerWithSyncer(t, syncer)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/catalog-sync", nil, adminHeaders())
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadGateway, rec.Body.String())
	}
}

func TestRouter_AdminCatalogSync_ReturnsConflictWhenAlreadyRunning(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	client := &blockingSyncCatalogClient{entered: entered, release: release}
	syncer := catalogsync.New(client, testRepo)
	handler := resetServerWithSyncer(t, syncer)

	go func() {
		_, _ = syncer.Sync(context.Background())
	}()
	<-entered
	defer close(release)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/catalog-sync", nil, adminHeaders())
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusConflict, rec.Body.String())
	}
}

type blockingSyncCatalogClient struct {
	entered chan struct{}
	release chan struct{}
}

func (b *blockingSyncCatalogClient) ListCatalogItems(context.Context) ([]tossplace.CatalogItem, error) {
	close(b.entered)
	<-b.release
	return nil, nil
}
