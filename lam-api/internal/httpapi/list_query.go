package httpapi

import (
	"fmt"
	"net/url"
	"strconv"
	"time"
)

const (
	defaultListPage     = 1
	defaultListPageSize = 20
	maxListPageSize     = 100
)

// customerRequestListQuery is the parsed, validated form of the optional
// query parameters accepted by GET /api/v1/admin/customer-requests. Every
// field carries a value even when the caller supplied nothing for it — the
// zero-parameter case is only distinguished by the separately-returned
// hasParams flag, which the caller uses to decide whether to keep replying
// with the legacy plain array or switch to the paginated envelope.
type customerRequestListQuery struct {
	Page     int
	PageSize int
	Status   string // "" = all statuses
	Kind     string // "all" | "general" | "song"
	Search   string
	From     *time.Time // inclusive; nil = no lower bound
	To       *time.Time // exclusive; nil = no upper bound
	Sort     string     // "status" | "createdAt" | "tableNumber"
	Order    string     // "asc" | "desc"
}

// specialRequestListQuery is the equivalent parsed query for
// GET /api/v1/admin/special-requests.
type specialRequestListQuery struct {
	Page     int
	PageSize int
	Gender   string // "" = both genders
	Search   string
	From     *time.Time // inclusive; nil = no lower bound
	To       *time.Time // exclusive; nil = no upper bound
	Sort     string     // "createdAt" | "name"
	Order    string     // "asc" | "desc"
}

var customerRequestListParamKeys = []string{"page", "pageSize", "status", "kind", "q", "from", "to", "sort", "order"}

var specialRequestListParamKeys = []string{"page", "pageSize", "gender", "q", "from", "to", "sort", "order"}

func hasAnyQueryParam(query url.Values, keys []string) bool {
	for _, key := range keys {
		if query.Has(key) {
			return true
		}
	}
	return false
}

func parsePage(query url.Values) (int, error) {
	raw := query.Get("page")
	if raw == "" {
		return defaultListPage, nil
	}
	page, err := strconv.Atoi(raw)
	if err != nil || page < 1 {
		return 0, fmt.Errorf("invalid page: %q", raw)
	}
	return page, nil
}

// parseFromTo parses the optional "from"/"to" RFC3339 instant-range params
// shared by the customer-request, special-request and payment-order list
// queries. Both are optional and independent; when both are present, from
// must be strictly before to (an empty or inverted range is rejected here
// rather than silently returning zero rows).
func parseFromTo(query url.Values) (*time.Time, *time.Time, error) {
	var from, to *time.Time

	if raw := query.Get("from"); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid from: %q", raw)
		}
		from = &parsed
	}

	if raw := query.Get("to"); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid to: %q", raw)
		}
		to = &parsed
	}

	if from != nil && to != nil && !from.Before(*to) {
		return nil, nil, fmt.Errorf("invalid range: from %q must be before to %q", query.Get("from"), query.Get("to"))
	}

	return from, to, nil
}

func parsePageSize(query url.Values) (int, error) {
	raw := query.Get("pageSize")
	if raw == "" {
		return defaultListPageSize, nil
	}
	pageSize, err := strconv.Atoi(raw)
	if err != nil || pageSize < 1 || pageSize > maxListPageSize {
		return 0, fmt.Errorf("invalid pageSize: %q", raw)
	}
	return pageSize, nil
}

func parseCustomerRequestListQuery(query url.Values) (customerRequestListQuery, bool, error) {
	q := customerRequestListQuery{
		Page:     defaultListPage,
		PageSize: defaultListPageSize,
		Kind:     "all",
		Sort:     "status",
		Order:    "asc",
	}

	page, err := parsePage(query)
	if err != nil {
		return q, false, err
	}
	q.Page = page

	pageSize, err := parsePageSize(query)
	if err != nil {
		return q, false, err
	}
	q.PageSize = pageSize

	if status := query.Get("status"); status != "" {
		switch status {
		case "pending", "checked", "completed":
			q.Status = status
		default:
			return q, false, fmt.Errorf("invalid status: %q", status)
		}
	}

	if kind := query.Get("kind"); kind != "" {
		switch kind {
		case "all", "general", "song":
			q.Kind = kind
		default:
			return q, false, fmt.Errorf("invalid kind: %q", kind)
		}
	}

	q.Search = query.Get("q")

	from, to, err := parseFromTo(query)
	if err != nil {
		return q, false, err
	}
	q.From = from
	q.To = to

	if sort := query.Get("sort"); sort != "" {
		switch sort {
		case "status", "createdAt", "tableNumber":
			q.Sort = sort
		default:
			return q, false, fmt.Errorf("invalid sort: %q", sort)
		}
	}

	// The default order depends on which sort ends up in effect (explicit or
	// default): "status" reads naturally ascending (pending first), every
	// other sort reads naturally descending (newest/latest first). This must
	// be resolved before applying an explicit "order" override below.
	if q.Sort == "status" {
		q.Order = "asc"
	} else {
		q.Order = "desc"
	}

	if order := query.Get("order"); order != "" {
		switch order {
		case "asc", "desc":
			q.Order = order
		default:
			return q, false, fmt.Errorf("invalid order: %q", order)
		}
	}

	return q, hasAnyQueryParam(query, customerRequestListParamKeys), nil
}

func parseSpecialRequestListQuery(query url.Values) (specialRequestListQuery, bool, error) {
	q := specialRequestListQuery{
		Page:     defaultListPage,
		PageSize: defaultListPageSize,
		Sort:     "createdAt",
		Order:    "desc",
	}

	page, err := parsePage(query)
	if err != nil {
		return q, false, err
	}
	q.Page = page

	pageSize, err := parsePageSize(query)
	if err != nil {
		return q, false, err
	}
	q.PageSize = pageSize

	if gender := query.Get("gender"); gender != "" {
		switch gender {
		case "male", "female":
			q.Gender = gender
		default:
			return q, false, fmt.Errorf("invalid gender: %q", gender)
		}
	}

	q.Search = query.Get("q")

	from, to, err := parseFromTo(query)
	if err != nil {
		return q, false, err
	}
	q.From = from
	q.To = to

	if sort := query.Get("sort"); sort != "" {
		switch sort {
		case "createdAt", "name":
			q.Sort = sort
		default:
			return q, false, fmt.Errorf("invalid sort: %q", sort)
		}
	}

	if order := query.Get("order"); order != "" {
		switch order {
		case "asc", "desc":
			q.Order = order
		default:
			return q, false, fmt.Errorf("invalid order: %q", order)
		}
	}

	return q, hasAnyQueryParam(query, specialRequestListParamKeys), nil
}

// paymentOrderListQuery is the parsed, validated form of the query
// parameters accepted by GET /api/v1/admin/payment-orders. Unlike
// customerRequestListQuery/specialRequestListQuery, there is no legacy
// unpaginated-array response to preserve for this endpoint, so callers
// always receive the paginated envelope — no hasParams flag needed.
type paymentOrderListQuery struct {
	Page          int
	PageSize      int
	Status        string // "" = all | "READY" | "ACKNOWLEDGED" | "DONE" | "CANCELLED"
	PosSyncStatus string // "" = all | "PENDING" | "SUCCEEDED" | "FAILED" | "NOT_CONFIGURED"
	Search        string
	From          *time.Time // inclusive
	To            *time.Time // exclusive
	Sort          string     // "createdAt" | "amount"
	Order         string     // "asc" | "desc"
}

func parsePaymentOrderListQuery(query url.Values) (paymentOrderListQuery, error) {
	q := paymentOrderListQuery{
		Page:     defaultListPage,
		PageSize: defaultListPageSize,
		Sort:     "createdAt",
		Order:    "desc",
	}

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
		case "READY", "ACKNOWLEDGED", "DONE", "CANCELLED":
			q.Status = status
		default:
			return q, fmt.Errorf("invalid status: %q", status)
		}
	}

	if posSync := query.Get("posSync"); posSync != "" {
		switch posSync {
		case "PENDING", "SUCCEEDED", "FAILED", "NOT_CONFIGURED":
			q.PosSyncStatus = posSync
		default:
			return q, fmt.Errorf("invalid posSync: %q", posSync)
		}
	}

	q.Search = query.Get("q")

	from, to, err := parseFromTo(query)
	if err != nil {
		return q, err
	}
	q.From = from
	q.To = to

	if sort := query.Get("sort"); sort != "" {
		switch sort {
		case "createdAt", "amount":
			q.Sort = sort
		default:
			return q, fmt.Errorf("invalid sort: %q", sort)
		}
	}

	if order := query.Get("order"); order != "" {
		switch order {
		case "asc", "desc":
			q.Order = order
		default:
			return q, fmt.Errorf("invalid order: %q", order)
		}
	}

	return q, nil
}

// paymentOrderStatsQuery is the parsed, validated query for
// GET /api/v1/admin/payment-orders/stats. Unlike paymentOrderListQuery,
// `from`/`to` are required here (not optional filters) — the sales-stats
// screen always has an explicit range picked by the operator, so there is
// no "all time" default to fall back to.
type paymentOrderStatsQuery struct {
	From             time.Time
	To               time.Time
	BusinessDayBasis bool // dayBasis=business vs the "calendar" default
}

func parsePaymentOrderStatsQuery(query url.Values) (paymentOrderStatsQuery, error) {
	fromRaw := query.Get("from")
	toRaw := query.Get("to")
	if fromRaw == "" || toRaw == "" {
		return paymentOrderStatsQuery{}, fmt.Errorf("from and to are required")
	}

	from, err := time.Parse(time.RFC3339, fromRaw)
	if err != nil {
		return paymentOrderStatsQuery{}, fmt.Errorf("invalid from: %q", fromRaw)
	}
	to, err := time.Parse(time.RFC3339, toRaw)
	if err != nil {
		return paymentOrderStatsQuery{}, fmt.Errorf("invalid to: %q", toRaw)
	}
	if !from.Before(to) {
		return paymentOrderStatsQuery{}, fmt.Errorf("invalid range: from %q must be before to %q", fromRaw, toRaw)
	}

	businessDayBasis := false
	if dayBasis := query.Get("dayBasis"); dayBasis != "" {
		switch dayBasis {
		case "business":
			businessDayBasis = true
		case "calendar":
			businessDayBasis = false
		default:
			return paymentOrderStatsQuery{}, fmt.Errorf("invalid dayBasis: %q", dayBasis)
		}
	}

	return paymentOrderStatsQuery{From: from, To: to, BusinessDayBasis: businessDayBasis}, nil
}
