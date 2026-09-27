package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/notify"
	"github.com/her9797/laam/laam-api/internal/store"
)

type completePOSPluginOrderRequest struct {
	ClaimToken string `json:"claimToken"`
	POSOrderID string `json:"posOrderId"`
}

// posPluginDiagnosticsRequest carries a crash report from the plugin
// worker. It is sent unauthenticated: a crash during the plugin's own SDK
// import happens before it can ever read the API token out of its
// settings, so this is the only path left for a report to reach us. Toss
// gives no other way to see a deployed worker plugin's console log short
// of wiring up Sentry.
type posPluginDiagnosticsRequest struct {
	Stage   string `json:"stage"`
	Message string `json:"message"`
}

type failPOSPluginOrderRequest struct {
	ClaimToken string `json:"claimToken"`
	Error      string `json:"error"`
}

// tableSyncPendingHeaderName lets the plugin's fallback order poll learn
// whether an admin table sync is waiting, so it only calls
// POST /api/v1/pos-plugin/tables/claim when there is something to claim.
const tableSyncPendingHeaderName = "X-Table-Sync-Pending"

// tableSyncPendingHeaderValue answers "1" when a table sync request waits
// to be claimed. A failed lookup also answers "1": the worst case is one
// extra tables/claim call, while "0" could hide a sync until it times out.
func tableSyncPendingHeaderValue(r *http.Request, repository *store.Repository) string {
	pending, err := repository.HasPendingPOSTableSync(r.Context())
	if err != nil {
		log.Printf("pos-plugin: failed to check pending table sync: %v", err)
		return "1"
	}
	if pending {
		return "1"
	}
	return "0"
}

const (
	// posPluginRealtimeFallbackPollSeconds is how often the plugin still
	// polls while its Realtime socket is up: it covers lost signals and
	// failed orders that become claimable again after their retry delay
	// (no signal is sent for those).
	posPluginRealtimeFallbackPollSeconds = 60
	// posPluginPollingOnlySeconds keeps the plugin's original fast polling
	// when Realtime is not configured.
	posPluginPollingOnlySeconds = 3
)

type posPluginRealtimeEvents struct {
	OrderReady         string `json:"orderReady"`
	TableSyncRequested string `json:"tableSyncRequested"`
}

type posPluginRealtimeConfig struct {
	Enabled             bool                     `json:"enabled"`
	URL                 string                   `json:"url,omitempty"`
	APIKey              string                   `json:"apiKey,omitempty"`
	Topic               string                   `json:"topic,omitempty"`
	Events              *posPluginRealtimeEvents `json:"events,omitempty"`
	FallbackPollSeconds int                      `json:"fallbackPollSeconds"`
}

// buildPOSPluginRealtimeConfig tells the plugin how to open its Supabase
// Realtime websocket. It only ever exposes the PUBLIC anon key. Realtime is
// reported disabled unless laam-api can also send the signals (broadcast
// key set) — otherwise the plugin would wait on a socket nobody writes to.
func buildPOSPluginRealtimeConfig(cfg config.Config) posPluginRealtimeConfig {
	disabled := posPluginRealtimeConfig{Enabled: false, FallbackPollSeconds: posPluginPollingOnlySeconds}
	anonKey := strings.TrimSpace(cfg.SupabaseAnonKey)
	if anonKey == "" || strings.TrimSpace(cfg.SupabaseBroadcastKey) == "" {
		return disabled
	}
	base, err := url.Parse(strings.TrimSpace(cfg.SupabaseURL))
	if err != nil || base.Host == "" {
		return disabled
	}
	socket := url.URL{Host: base.Host, Path: "/realtime/v1/websocket"}
	switch base.Scheme {
	case "https":
		socket.Scheme = "wss"
	case "http":
		socket.Scheme = "ws"
	default:
		return disabled
	}
	socket.RawQuery = url.Values{"apikey": {anonKey}, "vsn": {"1.0.0"}}.Encode()

	return posPluginRealtimeConfig{
		Enabled: true,
		URL:     socket.String(),
		APIKey:  anonKey,
		Topic:   "realtime:" + notify.POSPluginTopic,
		Events: &posPluginRealtimeEvents{
			OrderReady:         notify.POSOrderReadyEvent,
			TableSyncRequested: notify.POSTableSyncRequestedEvent,
		},
		FallbackPollSeconds: posPluginRealtimeFallbackPollSeconds,
	}
}

func registerPOSPluginRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config, broadcaster *notify.Broadcaster) {
	mux.HandleFunc("/api/v1/pos-plugin/realtime-config", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requirePOSPluginAuth(w, r, cfg.POSPluginAPIToken) {
			return
		}
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, buildPOSPluginRealtimeConfig(cfg))
	}))

	mux.HandleFunc("/api/v1/pos-plugin/diagnostics", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var payload posPluginDiagnosticsRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid diagnostics request"))
			return
		}
		log.Printf("pos-plugin diagnostics: stage=%q message=%q", payload.Stage, payload.Message)
		w.WriteHeader(http.StatusNoContent)
	}))

	mux.HandleFunc("/api/v1/pos-plugin/orders/claim", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requirePOSPluginAuth(w, r, cfg.POSPluginAPIToken) {
			return
		}
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		w.Header().Set("Access-Control-Expose-Headers", tableSyncPendingHeaderName)
		if !posPluginClaimsEnabled(cfg.POSOrderProvider) {
			// Table sync requests can only be created in plugin mode.
			w.Header().Set(tableSyncPendingHeaderName, "0")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set(tableSyncPendingHeaderName, tableSyncPendingHeaderValue(r, repository))

		claim, err := repository.ClaimPendingPOSPluginOrder(r.Context())
		if errors.Is(err, store.ErrNotFound) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, claim)
	}))

	mux.HandleFunc("/api/v1/pos-plugin/orders/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requirePOSPluginAuth(w, r, cfg.POSPluginAPIToken) {
			return
		}
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/api/v1/pos-plugin/orders/")
		orderID, action, ok := strings.Cut(path, "/")
		if !ok || strings.TrimSpace(orderID) == "" || strings.Contains(action, "/") {
			http.NotFound(w, r)
			return
		}

		switch action {
		case "complete":
			var payload completePOSPluginOrderRequest
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid POS completion request"))
				return
			}
			order, err := repository.GetPaymentOrder(r.Context(), orderID)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			if err := repository.CompletePOSPluginOrder(r.Context(), orderID, payload.ClaimToken, payload.POSOrderID); err != nil {
				writeStoreError(w, err)
				return
			}
			if order.Status == "READY" {
				sendNewOrderBroadcastAsync(broadcaster)
			}
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		case "fail":
			var payload failPOSPluginOrderRequest
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid POS failure request"))
				return
			}
			if err := repository.FailPOSPluginOrder(r.Context(), orderID, payload.ClaimToken, payload.Error); err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		default:
			http.NotFound(w, r)
		}
	}))
}

// maxPOSTableSnapshotBytes caps the table snapshot body. The plugin sends
// at most store.MaxPOSTableSnapshotTables small objects, so anything near
// this size is a broken or hostile client.
const maxPOSTableSnapshotBytes = 1 << 20

type completePOSTableSyncRequest struct {
	Halls []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	} `json:"halls"`
	Tables []struct {
		ID       int64  `json:"id"`
		Title    string `json:"title"`
		HallID   *int64 `json:"hallId"`
		Capacity *int   `json:"capacity"`
	} `json:"tables"`
}

type failPOSTableSyncRequest struct {
	Error string `json:"error"`
}

func registerPOSPluginTableRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config) {
	mux.HandleFunc("/api/v1/pos-plugin/table-mappings", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requirePOSPluginAuth(w, r, cfg.POSPluginAPIToken) {
			return
		}
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		mappings, err := repository.GetPOSTableMappings(r.Context())
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, mappings)
	}))

	mux.HandleFunc("/api/v1/pos-plugin/tables/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requirePOSPluginAuth(w, r, cfg.POSPluginAPIToken) {
			return
		}
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/pos-plugin/tables/"), "/")
		if path == "claim" {
			syncID, err := repository.ClaimPOSTableSync(r.Context())
			if errors.Is(err, store.ErrNotFound) {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"syncId": syncID})
			return
		}

		syncID, action, ok := strings.Cut(path, "/")
		if !ok || strings.TrimSpace(syncID) == "" || strings.Contains(action, "/") {
			http.NotFound(w, r)
			return
		}

		switch action {
		case "complete":
			var payload completePOSTableSyncRequest
			if err := json.NewDecoder(io.LimitReader(r.Body, maxPOSTableSnapshotBytes)).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid POS table snapshot"))
				return
			}
			snapshot := store.POSTableSnapshotInput{
				Halls:  make([]store.POSHallInput, 0, len(payload.Halls)),
				Tables: make([]store.POSTableInput, 0, len(payload.Tables)),
			}
			for _, hall := range payload.Halls {
				snapshot.Halls = append(snapshot.Halls, store.POSHallInput{ID: hall.ID, Name: hall.Name})
			}
			for _, table := range payload.Tables {
				snapshot.Tables = append(snapshot.Tables, store.POSTableInput{
					ID: table.ID, Title: table.Title, HallID: table.HallID, Capacity: table.Capacity,
				})
			}
			if err := repository.CompletePOSTableSync(r.Context(), syncID, snapshot); err != nil {
				writeStoreError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case "fail":
			var payload failPOSTableSyncRequest
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid POS table sync failure"))
				return
			}
			if err := repository.FailPOSTableSync(r.Context(), syncID, payload.Error); err != nil {
				writeStoreError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
}

func requirePOSPluginAuth(w http.ResponseWriter, r *http.Request, token string) bool {
	token = strings.TrimSpace(token)
	actual := []byte(strings.TrimSpace(r.Header.Get("Authorization")))
	expected := []byte("Bearer " + token)
	if token == "" || len(actual) != len(expected) || subtle.ConstantTimeCompare(actual, expected) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "POS plugin authorization required"})
		return false
	}
	return true
}
