package httpapi

import (
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/lamdata"
	"github.com/her9797/laam/laam-api/internal/store"
)

// paymentBillListQuery is the parsed, validated query for
// GET /api/v1/admin/payment-bills. from/to bound the bill's opened_at.
// The list is always ordered newest opened first, so there is no sort.
type paymentBillListQuery struct {
	Page       int
	PageSize   int
	Status     string // "" = all | "OPEN" | "PAID" | "CANCELLED"
	SourceType string // "" = all | a TossPlace payment sourceType
	Search     string
	From       *time.Time // inclusive
	To         *time.Time // exclusive
}

// paymentBillSourceTypes are the TossPlace payment sourceType values a bill
// list can be filtered by (see pos_payments.source_type).
var paymentBillSourceTypes = map[string]bool{
	"CASH":             true,
	"CARD":             true,
	"PREPAID_VALUE":    true,
	"ACCOUNT_TRANSFER": true,
	"BARCODE":          true,
	"EXTERNAL":         true,
	"UNDEFINED":        true,
}

func parsePaymentBillListQuery(query url.Values) (paymentBillListQuery, error) {
	q := paymentBillListQuery{Page: defaultListPage, PageSize: defaultListPageSize}

	page, err := parsePage(query)
	if err != nil {
		return q, err
	}
	q.Page = page

	pageSize, err := parsePageSize(query)
	if err != nil {
		return q, err
	}
	q.PageSize = pageSize

	if status := query.Get("status"); status != "" {
		switch status {
		case "OPEN", "PAID", "CANCELLED":
			q.Status = status
		default:
			return q, fmt.Errorf("invalid status: %q", status)
		}
	}

	if sourceType := query.Get("sourceType"); sourceType != "" {
		if !paymentBillSourceTypes[sourceType] {
			return q, fmt.Errorf("invalid sourceType: %q", sourceType)
		}
		q.SourceType = sourceType
	}

	q.Search = query.Get("q")

	from, to, err := parseFromTo(query)
	if err != nil {
		return q, err
	}
	q.From = from
	q.To = to

	return q, nil
}

func registerPaymentBillRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config) {
	mux.HandleFunc("/api/v1/admin/payment-bills", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		query, err := parsePaymentBillListQuery(r.URL.Query())
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		items, total, err := repository.ListPOSBillsPage(r.Context(), store.POSBillFilter{
			Status:     query.Status,
			SourceType: query.SourceType,
			Search:     query.Search,
			From:       query.From,
			To:         query.To,
			Page:       query.Page,
			PageSize:   query.PageSize,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, lamdata.POSBillPage{
			Items:    items,
			Page:     query.Page,
			PageSize: query.PageSize,
			Total:    total,
		})
	}))

	mux.HandleFunc("/api/v1/admin/payment-bills/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		id, ok := parseResourceID(r.URL.Path, "/api/v1/admin/payment-bills/")
		if !ok {
			http.NotFound(w, r)
			return
		}

		bill, err := repository.GetPOSBillForAdmin(r.Context(), id)
		if err != nil {
			writeStoreError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, bill)
	}))
}
