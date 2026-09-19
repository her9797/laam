package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
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

func registerPOSPluginRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config, broadcaster *notify.Broadcaster) {
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
		if !posPluginClaimsEnabled(cfg.POSOrderProvider) {
			w.WriteHeader(http.StatusNoContent)
			return
		}

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
