package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/her9797/lam/lam-api/internal/catalogsync"
	"github.com/her9797/lam/lam-api/internal/config"
	"github.com/her9797/lam/lam-api/internal/lamdata"
	"github.com/her9797/lam/lam-api/internal/notify"
	"github.com/her9797/lam/lam-api/internal/store"
)

// NewMux wires the full admin/customer HTTP API. syncer may be nil — Toss
// Place catalog sync is optional (see cmd/server/main.go's
// startTossCatalogSync), in which case the manual resync endpoint below
// reports 503 instead of panicking on a nil receiver.
func NewMux(repository *store.Repository, cfg config.Config, syncer *catalogsync.Syncer) http.Handler {
	mux := http.NewServeMux()
	broadcaster := notify.NewBroadcaster(cfg.SupabaseURL, cfg.SupabaseBroadcastKey)

	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	registerPaymentRoutes(mux, repository, cfg, broadcaster)
	registerSongRoutes(mux, repository, cfg)
	registerTableRoutes(mux, cfg)
	registerTossPlaceWebhookRoutes(mux, repository, cfg)

	mux.HandleFunc("/api/v1/bootstrap", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		data, err := repository.GetBootstrapData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, data)
	}))

	mux.HandleFunc("/api/v1/menu", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		data, err := repository.GetMenuData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, data)
	}))

	mux.HandleFunc("/api/v1/customer-requests", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload createCustomerRequestRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := repository.CreateCustomerRequest(
			r.Context(),
			strings.TrimSpace(payload.TableNumber),
			strings.TrimSpace(payload.Text),
		); err != nil {
			writeStoreError(w, err)
			return
		}

		sendNewRequestBroadcastAsync(broadcaster)
		writeJSON(w, http.StatusCreated, map[string]string{"status": "ok"})
	}))

	mux.HandleFunc("/api/v1/special-requests", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload createSpecialRequestRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := repository.CreateSpecialRequest(r.Context(), storeInputSpecialRequest(payload)); err != nil {
			writeStoreError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, map[string]string{"status": "ok"})
	}))

	mux.HandleFunc("/api/v1/menu-images/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		imageID, ok := strings.CutPrefix(r.URL.Path, "/api/v1/menu-images/")
		if !ok || !strings.HasSuffix(imageID, "/content") {
			http.NotFound(w, r)
			return
		}

		imageID = strings.TrimSuffix(imageID, "/content")
		imageID = strings.Trim(imageID, "/")
		if imageID == "" {
			http.NotFound(w, r)
			return
		}

		content, err := repository.GetMenuImageContent(r.Context(), imageID)
		if err != nil {
			writeStoreError(w, err)
			return
		}

		w.Header().Set("Content-Type", content.MimeType)
		w.Header().Set("Cache-Control", "public, max-age=300")
		_, _ = w.Write(content.Content)
	}))

	mux.HandleFunc("/api/v1/admin/categories", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload createCategoryRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := repository.CreateCategory(r.Context(), strings.TrimSpace(payload.ID), strings.TrimSpace(payload.Label), payload.IsVisible); err != nil {
			writeStoreError(w, err)
			return
		}

		bootstrap, err := repository.GetBootstrapData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusCreated, bootstrap)
	}))

	mux.HandleFunc("/api/v1/admin/store-profile", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}
		if r.Method != http.MethodPatch {
			writeMethodNotAllowed(w)
			return
		}

		var payload updateStoreCopiesRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := repository.UpdateStoreCopies(r.Context(), payload.SongRequestCopy, payload.RequestCopy, payload.EventCopy); err != nil {
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

	mux.HandleFunc("/api/v1/admin/categories/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method == http.MethodDelete {
			id, ok := parseResourceID(r.URL.Path, "/api/v1/admin/categories/")
			if !ok {
				http.NotFound(w, r)
				return
			}

			if err := repository.DeleteCategory(r.Context(), id); err != nil {
				writeStoreError(w, err)
				return
			}

			bootstrap, err := repository.GetBootstrapData(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}

			writeJSON(w, http.StatusOK, bootstrap)
			return
		}

		if r.Method != http.MethodPatch {
			writeMethodNotAllowed(w)
			return
		}

		id, ok := parseVisibilityResourceID(r.URL.Path, "/api/v1/admin/categories/")
		if !ok {
			http.NotFound(w, r)
			return
		}

		var payload updateVisibilityRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := repository.UpdateCategoryVisibility(r.Context(), id, payload.IsVisible); err != nil {
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

	mux.HandleFunc("/api/v1/admin/menu-items", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload createMenuItemRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := repository.CreateMenuItem(r.Context(), store.CreateMenuItemInput{
			CategoryID:  strings.TrimSpace(payload.CategoryID),
			Badge:       strings.TrimSpace(payload.Badge),
			BadgeColor:  strings.TrimSpace(payload.BadgeColor),
			Name:        strings.TrimSpace(payload.Name),
			Description: strings.TrimSpace(payload.Description),
			Price:       strings.TrimSpace(payload.Price),
			IsVisible:   payload.IsVisible,
		}); err != nil {
			writeStoreError(w, err)
			return
		}

		bootstrap, err := repository.GetBootstrapData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusCreated, bootstrap)
	}))

	mux.HandleFunc("/api/v1/admin/menu-items/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodGet &&
			r.Method != http.MethodPost &&
			r.Method != http.MethodPatch &&
			r.Method != http.MethodDelete {
			writeMethodNotAllowed(w)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/menu-items/")

		// Recipe is an admin-only subresource: it returns just the recipe
		// object (never the full bootstrap tree, which is the public
		// contract lam-web also consumes) and is the only subresource here
		// that supports GET.
		if strings.HasSuffix(path, "/recipe") {
			menuItemID := strings.TrimSuffix(path, "/recipe")
			menuItemID = strings.Trim(menuItemID, "/")
			if menuItemID == "" {
				http.NotFound(w, r)
				return
			}

			switch r.Method {
			case http.MethodGet:
				recipe, err := repository.GetMenuItemRecipe(r.Context(), menuItemID)
				if err != nil {
					writeStoreError(w, err)
					return
				}
				writeJSON(w, http.StatusOK, recipe)
			case http.MethodPatch:
				var payload updateMenuItemRecipeRequest
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					writeError(w, http.StatusBadRequest, err)
					return
				}

				if err := repository.UpdateMenuItemRecipe(r.Context(), menuItemID, payload.Ingredients, payload.Instructions); err != nil {
					writeStoreError(w, err)
					return
				}

				recipe, err := repository.GetMenuItemRecipe(r.Context(), menuItemID)
				if err != nil {
					writeStoreError(w, err)
					return
				}
				writeJSON(w, http.StatusOK, recipe)
			default:
				writeMethodNotAllowed(w)
			}
			return
		}

		if r.Method == http.MethodGet {
			http.NotFound(w, r)
			return
		}

		if r.Method == http.MethodDelete {
			id, ok := parseResourceID(r.URL.Path, "/api/v1/admin/menu-items/")
			if !ok {
				http.NotFound(w, r)
				return
			}

			if err := repository.DeleteMenuItem(r.Context(), id); err != nil {
				writeStoreError(w, err)
				return
			}

			bootstrap, err := repository.GetBootstrapData(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}

			writeJSON(w, http.StatusOK, bootstrap)
			return
		}

		if strings.HasSuffix(path, "/images") {
			menuItemID := strings.TrimSuffix(path, "/images")
			menuItemID = strings.Trim(menuItemID, "/")
			if menuItemID == "" || r.Method != http.MethodPost {
				http.NotFound(w, r)
				return
			}

			if err := r.ParseMultipartForm(8 << 20); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}

			file, header, err := r.FormFile("image")
			if err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			defer file.Close()

			content, err := io.ReadAll(file)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}

			isPrimary := strings.EqualFold(strings.TrimSpace(r.FormValue("isPrimary")), "true")
			displayArea := strings.TrimSpace(r.FormValue("displayArea"))
			focusX, _ := strconv.Atoi(strings.TrimSpace(r.FormValue("focusX")))
			focusY, _ := strconv.Atoi(strings.TrimSpace(r.FormValue("focusY")))
			if err := repository.CreateMenuImage(r.Context(), store.CreateMenuImageInput{
				MenuItemID:  menuItemID,
				Filename:    header.Filename,
				MimeType:    header.Header.Get("Content-Type"),
				Content:     content,
				IsPrimary:   isPrimary,
				DisplayArea: displayArea,
				FocusX:      focusX,
				FocusY:      focusY,
			}); err != nil {
				writeStoreError(w, err)
				return
			}
		} else {
			id, ok := parseVisibilityResourceID(r.URL.Path, "/api/v1/admin/menu-items/")
			if !ok || r.Method != http.MethodPatch {
				http.NotFound(w, r)
				return
			}

			var payload updateVisibilityRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}

			if err := repository.UpdateMenuItemVisibility(r.Context(), id, payload.IsVisible); err != nil {
				writeStoreError(w, err)
				return
			}
		}

		bootstrap, err := repository.GetBootstrapData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusCreated, bootstrap)
	}))

	mux.HandleFunc("/api/v1/admin/catalog-sync", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		if syncer == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("toss place catalog sync is not configured"))
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		result, err := syncer.Sync(ctx)
		if err != nil {
			if errors.Is(err, catalogsync.ErrSyncInProgress) {
				writeError(w, http.StatusConflict, err)
				return
			}
			writeError(w, http.StatusBadGateway, err)
			return
		}

		bootstrap, err := repository.GetBootstrapData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, lamdata.CatalogSyncResponse{
			Created: result.Created,
			Linked:  result.Linked,
			Updated: result.Updated,
			Data:    bootstrap,
		})
	}))

	mux.HandleFunc("/api/v1/admin/customer-requests", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method == http.MethodPatch {
			var payload bulkUpdateCustomerRequestStatusRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}

			if err := repository.UpdateCustomerRequestStatuses(r.Context(), payload.IDs, strings.TrimSpace(payload.Status)); err != nil {
				writeStoreError(w, err)
				return
			}

			requests, err := repository.ListCustomerRequests(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}

			writeJSON(w, http.StatusOK, requests)
			return
		}

		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		query, hasParams, err := parseCustomerRequestListQuery(r.URL.Query())
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if !hasParams {
			requests, err := repository.ListCustomerRequests(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, requests)
			return
		}

		items, total, err := repository.ListCustomerRequestsPage(r.Context(), store.CustomerRequestFilter{
			Status:   query.Status,
			Kind:     query.Kind,
			Search:   query.Search,
			From:     query.From,
			To:       query.To,
			Sort:     query.Sort,
			Order:    query.Order,
			Page:     query.Page,
			PageSize: query.PageSize,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, lamdata.CustomerRequestPage{
			Items:    items,
			Page:     query.Page,
			PageSize: query.PageSize,
			Total:    total,
		})
	}))

	mux.HandleFunc("/api/v1/admin/special-requests", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		query, hasParams, err := parseSpecialRequestListQuery(r.URL.Query())
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if !hasParams {
			requests, err := repository.ListSpecialRequests(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, requests)
			return
		}

		items, total, err := repository.ListSpecialRequestsPage(r.Context(), store.SpecialRequestFilter{
			Gender:   query.Gender,
			Search:   query.Search,
			From:     query.From,
			To:       query.To,
			Sort:     query.Sort,
			Order:    query.Order,
			Page:     query.Page,
			PageSize: query.PageSize,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, lamdata.SpecialRequestPage{
			Items:    items,
			Page:     query.Page,
			PageSize: query.PageSize,
			Total:    total,
		})
	}))

	mux.HandleFunc("/api/v1/admin/payment-orders", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		query, err := parsePaymentOrderListQuery(r.URL.Query())
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		items, total, err := repository.ListPaymentOrdersPage(r.Context(), store.PaymentOrderFilter{
			Status:        query.Status,
			PosSyncStatus: query.PosSyncStatus,
			Search:        query.Search,
			From:          query.From,
			To:            query.To,
			Sort:          query.Sort,
			Order:         query.Order,
			Page:          query.Page,
			PageSize:      query.PageSize,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, lamdata.PaymentOrderPage{
			Items:    items,
			Page:     query.Page,
			PageSize: query.PageSize,
			Total:    total,
		})
	}))

	mux.HandleFunc("/api/v1/admin/payment-orders/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method == http.MethodPatch {
			id, ok := parseStatusResourceID(r.URL.Path, "/api/v1/admin/payment-orders/")
			if !ok {
				http.NotFound(w, r)
				return
			}

			var payload updatePaymentOrderStatusRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}

			// The admin screen may only move an order READY -> ACKNOWLEDGED.
			// DONE/CANCELLED stay TossPlace-webhook-only (see
			// store.AcknowledgePaymentOrder's doc comment), so any other
			// requested status is rejected here before even reaching the
			// store layer.
			if strings.TrimSpace(payload.Status) != "ACKNOWLEDGED" {
				writeError(w, http.StatusBadRequest, fmt.Errorf("%w: status %q", store.ErrInvalidInput, payload.Status))
				return
			}

			order, err := repository.AcknowledgePaymentOrder(r.Context(), id)
			if err != nil {
				writeStoreError(w, err)
				return
			}

			writeJSON(w, http.StatusOK, order)
			return
		}

		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		id, ok := parseResourceID(r.URL.Path, "/api/v1/admin/payment-orders/")
		if !ok {
			http.NotFound(w, r)
			return
		}

		order, err := repository.GetPaymentOrderForAdmin(r.Context(), id)
		if err != nil {
			writeStoreError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, order)
	}))

	mux.HandleFunc("/api/v1/admin/payment-orders/stats", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		query, err := parsePaymentOrderStatsQuery(r.URL.Query())
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		stats, err := repository.GetPaymentOrderStats(r.Context(), query.From, query.To, query.BusinessDayBasis)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, stats)
	}))

	mux.HandleFunc("/api/v1/admin/customer-requests/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method == http.MethodDelete {
			id, ok := parseResourceID(r.URL.Path, "/api/v1/admin/customer-requests/")
			if !ok {
				http.NotFound(w, r)
				return
			}

			if err := repository.DeleteCustomerRequest(r.Context(), id); err != nil {
				writeStoreError(w, err)
				return
			}

			requests, err := repository.ListCustomerRequests(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}

			writeJSON(w, http.StatusOK, requests)
			return
		}

		if r.Method != http.MethodPatch {
			writeMethodNotAllowed(w)
			return
		}

		id, ok := parseStatusResourceID(r.URL.Path, "/api/v1/admin/customer-requests/")
		if !ok {
			http.NotFound(w, r)
			return
		}

		var payload updateCustomerRequestStatusRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := repository.UpdateCustomerRequestStatus(r.Context(), id, strings.TrimSpace(payload.Status)); err != nil {
			writeStoreError(w, err)
			return
		}

		requests, err := repository.ListCustomerRequests(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, requests)
	}))

	mux.HandleFunc("/api/v1/admin/special-requests/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodDelete {
			writeMethodNotAllowed(w)
			return
		}

		id, ok := parseResourceID(r.URL.Path, "/api/v1/admin/special-requests/")
		if !ok {
			http.NotFound(w, r)
			return
		}

		if err := repository.DeleteSpecialRequest(r.Context(), id); err != nil {
			writeStoreError(w, err)
			return
		}

		requests, err := repository.ListSpecialRequests(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, requests)
	}))

	mux.HandleFunc("/api/v1/admin/request-guides", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload createNoticeRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := repository.CreateRequestGuide(r.Context(), strings.TrimSpace(payload.Text), payload.IsVisible); err != nil {
			writeStoreError(w, err)
			return
		}

		bootstrap, err := repository.GetBootstrapData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusCreated, bootstrap)
	}))

	mux.HandleFunc("/api/v1/admin/request-guides/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method == http.MethodDelete {
			id, ok := parseResourceID(r.URL.Path, "/api/v1/admin/request-guides/")
			if !ok {
				http.NotFound(w, r)
				return
			}

			if err := repository.DeleteRequestGuide(r.Context(), id); err != nil {
				writeStoreError(w, err)
				return
			}

			bootstrap, err := repository.GetBootstrapData(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}

			writeJSON(w, http.StatusOK, bootstrap)
			return
		}

		if r.Method != http.MethodPatch {
			writeMethodNotAllowed(w)
			return
		}

		id, ok := parseVisibilityResourceID(r.URL.Path, "/api/v1/admin/request-guides/")
		if !ok {
			http.NotFound(w, r)
			return
		}

		var payload updateVisibilityRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := repository.UpdateRequestGuideVisibility(r.Context(), id, payload.IsVisible); err != nil {
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

	mux.HandleFunc("/api/v1/admin/notices", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload createNoticeRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := repository.CreateNotice(r.Context(), strings.TrimSpace(payload.Text), payload.IsVisible); err != nil {
			writeStoreError(w, err)
			return
		}

		bootstrap, err := repository.GetBootstrapData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusCreated, bootstrap)
	}))

	mux.HandleFunc("/api/v1/admin/notices/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}

		if r.Method == http.MethodDelete {
			id, ok := parseResourceID(r.URL.Path, "/api/v1/admin/notices/")
			if !ok {
				http.NotFound(w, r)
				return
			}

			if err := repository.DeleteNotice(r.Context(), id); err != nil {
				writeStoreError(w, err)
				return
			}

			bootstrap, err := repository.GetBootstrapData(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}

			writeJSON(w, http.StatusOK, bootstrap)
			return
		}

		if r.Method != http.MethodPatch {
			writeMethodNotAllowed(w)
			return
		}

		if id, ok := parseResourceID(r.URL.Path, "/api/v1/admin/notices/"); ok {
			var payload updateNoticeRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}

			if err := repository.UpdateNotice(r.Context(), id, strings.TrimSpace(payload.Text)); err != nil {
				writeStoreError(w, err)
				return
			}
		} else {
			id, ok := parseVisibilityResourceID(r.URL.Path, "/api/v1/admin/notices/")
			if !ok {
				http.NotFound(w, r)
				return
			}

			var payload updateVisibilityRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}

			if err := repository.UpdateNoticeVisibility(r.Context(), id, payload.IsVisible); err != nil {
				writeStoreError(w, err)
				return
			}
		}

		bootstrap, err := repository.GetBootstrapData(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, bootstrap)
	}))

	return mux
}

func parseVisibilityResourceID(path string, prefix string) (string, bool) {
	resourceID, ok := strings.CutPrefix(path, prefix)
	if !ok || !strings.HasSuffix(resourceID, "/visibility") {
		return "", false
	}

	resourceID = strings.TrimSuffix(resourceID, "/visibility")
	resourceID = strings.Trim(resourceID, "/")
	if resourceID == "" {
		return "", false
	}

	return resourceID, true
}

func parseStatusResourceID(path string, prefix string) (string, bool) {
	resourceID, ok := strings.CutPrefix(path, prefix)
	if !ok || !strings.HasSuffix(resourceID, "/status") {
		return "", false
	}

	resourceID = strings.TrimSuffix(resourceID, "/status")
	resourceID = strings.Trim(resourceID, "/")
	if resourceID == "" {
		return "", false
	}

	return resourceID, true
}

func storeInputSpecialRequest(payload createSpecialRequestRequest) lamdata.SpecialRequest {
	return lamdata.SpecialRequest{
		TableNumber: strings.TrimSpace(payload.TableNumber),
		Gender:      strings.TrimSpace(payload.Gender),
		Name:        strings.TrimSpace(payload.Name),
		Age:         strings.TrimSpace(payload.Age),
		Residence:   strings.TrimSpace(payload.Residence),
		Instagram:   strings.TrimSpace(payload.Instagram),
		IdealType:   strings.TrimSpace(payload.IdealType),
		Text:        strings.TrimSpace(payload.Text),
	}
}

func parseResourceID(path string, prefix string) (string, bool) {
	resourceID, ok := strings.CutPrefix(path, prefix)
	if !ok {
		return "", false
	}

	resourceID = strings.Trim(resourceID, "/")
	if resourceID == "" || strings.Contains(resourceID, "/") {
		return "", false
	}

	return resourceID, true
}

func withCORS(allowedOrigin string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

func requireAdminAuth(w http.ResponseWriter, r *http.Request, adminAPIToken string) bool {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	expected := "Bearer " + adminAPIToken
	if authHeader != expected {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "admin authorization required"})
		return false
	}

	return true
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, err)
	case errors.Is(err, store.ErrAlreadyExists):
		writeError(w, http.StatusConflict, err)
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, err)
	default:
		writeError(w, http.StatusInternalServerError, err)
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

// sendNewRequestBroadcastAsync fires the Realtime Broadcast signal in the
// background so a slow or unreachable Supabase endpoint never adds latency
// to (or fails) the customer request creation it follows — see
// docs/plans/2026-09-04-admin-request-notifications.md section 4.7. It
// uses its own background context rather than the request's, since the
// request (and its context) may already be finished by the time this
// completes. broadcaster.Send is itself a no-op when Supabase isn't
// configured, so this is safe to call unconditionally.
func sendNewRequestBroadcastAsync(broadcaster *notify.Broadcaster) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := broadcaster.Send(ctx, notify.RequestsTopic, notify.NewRequestEvent, notify.NewRequestPayload{Type: notify.NewRequestEvent}); err != nil {
			log.Printf("notify: failed to send new-request broadcast: %v", err)
		}
	}()
}

// sendNewOrderBroadcastAsync is the payment-order counterpart of
// sendNewRequestBroadcastAsync, with the same best-effort contract: the
// signal must never add latency to, or fail, the payment confirmation it
// follows — a completed sale is already recorded by the time this runs, so
// a lost alarm is recoverable (the admin web's safety-net poll still
// catches it) while a failed confirmation response is not.
func sendNewOrderBroadcastAsync(broadcaster *notify.Broadcaster) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := broadcaster.Send(ctx, notify.OrdersTopic, notify.NewOrderEvent, notify.NewOrderPayload{Type: notify.NewOrderEvent}); err != nil {
			log.Printf("notify: failed to send new-order broadcast: %v", err)
		}
	}()
}
