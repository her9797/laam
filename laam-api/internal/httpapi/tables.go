package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/store"
)

type adminTable struct {
	ID            string     `json:"id"`
	Area          string     `json:"area"`
	Number        int        `json:"number"`
	QrURL         string     `json:"qrUrl"`
	POSTableID    *int64     `json:"posTableId"`
	POSTableTitle *string    `json:"posTableTitle"`
	HallName      *string    `json:"hallName"`
	LinkedAt      *time.Time `json:"linkedAt"`
}

type adminTablesResponse struct {
	Tables        []adminTable        `json:"tables"`
	POSOnlyTables []store.POSTable    `json:"posOnlyTables"`
	LastSyncedAt  *time.Time          `json:"lastSyncedAt"`
	PendingSync   *store.POSTableSync `json:"pendingSync"`
}

type createAdminTableRequest struct {
	POSTableID int64  `json:"posTableId"`
	ID         string `json:"id"`
}

type updateTablePOSLinkRequest struct {
	POSTableID *int64 `json:"posTableId"`
}

type renameQrTableRequest struct {
	ID string `json:"id"`
}

func registerTableRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config) {
	mux.HandleFunc("/api/v1/admin/tables", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}
		if !requireQrConfig(w, cfg) {
			return
		}

		switch r.Method {
		case http.MethodGet:
			overview, err := repository.GetTableLinkOverview(r.Context())
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, adminTablesResponse{
				Tables:        adminTables(cfg, overview.Tables),
				POSOnlyTables: overview.POSOnlyTables,
				LastSyncedAt:  overview.LastSyncedAt,
				PendingSync:   overview.PendingSync,
			})
		case http.MethodPost:
			var payload createAdminTableRequest
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid table request"))
				return
			}
			if payload.POSTableID <= 0 {
				writeError(w, http.StatusBadRequest, fmt.Errorf("%w: posTableId is required", store.ErrInvalidInput))
				return
			}
			table, err := repository.CreateQrTable(r.Context(), payload.ID, payload.POSTableID)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, adminTableOf(cfg, table))
		default:
			writeMethodNotAllowed(w)
		}
	}))

	mux.HandleFunc("/api/v1/admin/tables/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/admin/tables/"), "/")

		if path == "pos-sync" {
			if r.Method != http.MethodPost {
				writeMethodNotAllowed(w)
				return
			}
			// Only the POS plugin can read the table list, and it only polls
			// in plugin mode with a token to authenticate. Without either,
			// nobody will ever claim the request — say so now instead of
			// leaving the operator watching a 30s timeout.
			if !posPluginClaimsEnabled(cfg.POSOrderProvider) || cfg.POSPluginAPIToken == "" {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{
					"error": "POS plugin mode is off, so no plugin can answer a table sync",
					"code":  "pos_plugin_disabled",
				})
				return
			}
			sync, created, err := repository.RequestPOSTableSync(r.Context())
			if err != nil {
				writeStoreError(w, err)
				return
			}
			status := http.StatusOK
			if created {
				status = http.StatusCreated
			}
			writeJSON(w, status, sync)
			return
		}

		if syncID, ok := strings.CutPrefix(path, "pos-sync/"); ok {
			if r.Method != http.MethodGet {
				writeMethodNotAllowed(w)
				return
			}
			if syncID == "" || strings.Contains(syncID, "/") {
				http.NotFound(w, r)
				return
			}
			sync, err := repository.GetPOSTableSync(r.Context(), syncID)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, sync)
			return
		}

		// PATCH /admin/tables/{id} renames the QR table itself. The seeded
		// layout and the id derived from a POS table name are guesses, so an
		// operator corrects one here; the POS link rides along unchanged.
		if renameID, ok := strings.CutSuffix(path, "/code"); ok {
			if renameID == "" || strings.Contains(renameID, "/") {
				http.NotFound(w, r)
				return
			}
			if r.Method != http.MethodPatch {
				writeMethodNotAllowed(w)
				return
			}
			if !requireQrConfig(w, cfg) {
				return
			}

			var payload renameQrTableRequest
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid table code request"))
				return
			}

			table, err := repository.RenameQrTable(r.Context(), renameID, payload.ID)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, adminTableOf(cfg, table))
			return
		}

		qrTableID, ok := strings.CutSuffix(path, "/pos-link")
		if !ok || qrTableID == "" || strings.Contains(qrTableID, "/") {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPatch {
			writeMethodNotAllowed(w)
			return
		}
		if !requireQrConfig(w, cfg) {
			return
		}

		var payload updateTablePOSLinkRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid POS link request"))
			return
		}
		if payload.POSTableID != nil && *payload.POSTableID <= 0 {
			writeError(w, http.StatusBadRequest, fmt.Errorf("%w: posTableId must be positive or null", store.ErrInvalidInput))
			return
		}

		table, err := repository.LinkQrTablePOSTable(r.Context(), qrTableID, payload.POSTableID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, adminTableOf(cfg, table))
	}))
}

// requireQrConfig guards the responses that carry a signed QR URL. Signing
// with an empty secret would hand out QR codes laam-web rejects, so the
// endpoint reports a server misconfiguration instead.
func requireQrConfig(w http.ResponseWriter, cfg config.Config) bool {
	if cfg.QRSigningSecret == "" || cfg.CustomerWebBaseURL == "" {
		writeError(w, http.StatusInternalServerError, errors.New("qr signing secret or customer web base url is not configured"))
		return false
	}
	return true
}

func adminTables(cfg config.Config, tables []store.QrTable) []adminTable {
	out := make([]adminTable, 0, len(tables))
	for _, table := range tables {
		out = append(out, adminTableOf(cfg, table))
	}
	return out
}

func adminTableOf(cfg config.Config, table store.QrTable) adminTable {
	return adminTable{
		ID:            table.ID,
		Area:          table.Area,
		Number:        table.Number,
		QrURL:         qrTableURL(cfg, table.ID),
		POSTableID:    table.POSTableID,
		POSTableTitle: table.POSTableTitle,
		HallName:      table.HallName,
		LinkedAt:      table.LinkedAt,
	}
}

func qrTableURL(cfg config.Config, id string) string {
	return fmt.Sprintf("%s/qr/enter?table=%s&sig=%s", cfg.CustomerWebBaseURL, id, signQrTable(cfg.QRSigningSecret, id))
}

// signQrTable matches laam-web/lib/auth.ts's createQrTableSignature exactly:
// HMAC-SHA256(secret, id) as a hex digest. The signature must be
// byte-for-byte identical or laam-web's /qr/enter verification rejects it.
func signQrTable(secret, id string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(id))
	return hex.EncodeToString(mac.Sum(nil))
}
