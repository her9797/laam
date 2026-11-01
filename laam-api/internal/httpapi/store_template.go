package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/lamdata"
	"github.com/her9797/laam/laam-api/internal/store"
)

// templatePreviewTTL is how long a signed preview link stays valid.
const templatePreviewTTL = 30 * time.Minute

type storeTemplateRequest struct {
	Template string `json:"template"`
}

func registerStoreTemplateRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config) {
	mux.HandleFunc("/api/v1/admin/store-template", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}
		if r.Method != http.MethodPatch {
			writeMethodNotAllowed(w)
			return
		}

		var payload storeTemplateRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := repository.UpdateStoreTemplate(r.Context(), payload.Template); err != nil {
			writeStoreError(w, err)
			return
		}

		bootstrap, err := repository.GetBootstrapData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, bootstrap)
	}))

	mux.HandleFunc("/api/v1/admin/store-template/preview", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		if !requireQrConfig(w, cfg) {
			return
		}

		var payload storeTemplateRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		template := strings.TrimSpace(payload.Template)
		if !lamdata.IsCustomerTemplate(template) {
			writeError(w, http.StatusBadRequest, errors.New("unknown customer template"))
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"url": templatePreviewURL(cfg, template, time.Now())})
	}))
}

// templatePreviewURL builds the laam-web link that lets an operator view the
// customer screen in a template before saving it. laam-web must verify sig
// against "preview:<template>:<exp>" and reject the link once exp has passed.
func templatePreviewURL(cfg config.Config, template string, now time.Time) string {
	exp := strconv.FormatInt(now.Add(templatePreviewTTL).Unix(), 10)
	sig := signTemplatePreview(cfg.QRSigningSecret, template, exp)
	return cfg.CustomerWebBaseURL + "/preview/enter?template=" + url.QueryEscape(template) +
		"&exp=" + url.QueryEscape(exp) + "&sig=" + url.QueryEscape(sig)
}

// signTemplatePreview reuses the table QR HMAC; the "preview:" prefix keeps a
// preview signature from ever being valid as a table signature.
func signTemplatePreview(secret, template, exp string) string {
	return signQrTable(secret, "preview:"+template+":"+exp)
}
