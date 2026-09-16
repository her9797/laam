package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"

	"github.com/her9797/laam/laam-api/internal/config"
)

type adminTable struct {
	ID     string `json:"id"`
	Area   string `json:"area"`
	Number int    `json:"number"`
	QrURL  string `json:"qrUrl"`
}

type adminTablesResponse struct {
	Tables []adminTable `json:"tables"`
}

// tableLayout mirrors laam-web/app/qr/enter/route.ts's normalizeQrTable,
// which caps "B" tables at 5 and "T" tables at 12 — this endpoint only
// exposes the subset of table numbers currently in physical use (B-01..05,
// T-01..10).
var tableLayout = []struct {
	area  string
	count int
}{
	{"B", 5},
	{"T", 10},
}

func registerTableRoutes(mux *http.ServeMux, cfg config.Config) {
	mux.HandleFunc("/api/v1/admin/tables", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		if cfg.QRSigningSecret == "" || cfg.CustomerWebBaseURL == "" {
			writeError(w, http.StatusInternalServerError, errors.New("qr signing secret or customer web base url is not configured"))
			return
		}

		writeJSON(w, http.StatusOK, adminTablesResponse{Tables: buildAdminTables(cfg)})
	}))
}

func buildAdminTables(cfg config.Config) []adminTable {
	var tables []adminTable
	for _, layout := range tableLayout {
		for number := 1; number <= layout.count; number++ {
			id := fmt.Sprintf("%s-%02d", layout.area, number)
			sig := signQrTable(cfg.QRSigningSecret, id)
			tables = append(tables, adminTable{
				ID:     id,
				Area:   layout.area,
				Number: number,
				QrURL:  fmt.Sprintf("%s/qr/enter?table=%s&sig=%s", cfg.CustomerWebBaseURL, id, sig),
			})
		}
	}
	return tables
}

// signQrTable matches laam-web/lib/auth.ts's createQrTableSignature exactly:
// HMAC-SHA256(secret, id) as a hex digest. The signature must be
// byte-for-byte identical or laam-web's /qr/enter verification rejects it.
func signQrTable(secret, id string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(id))
	return hex.EncodeToString(mac.Sum(nil))
}
