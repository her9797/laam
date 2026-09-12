package httpapi

import (
	"net/url"
	"testing"
	"time"
)

func TestParseCustomerRequestListQuery_Defaults(t *testing.T) {
	q, hasParams, err := parseCustomerRequestListQuery(url.Values{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if hasParams {
		t.Error("hasParams = true, want false when no recognized query key is present")
	}
	if q.Page != 1 || q.PageSize != 20 || q.Status != "" || q.Kind != "all" ||
		q.Search != "" || q.Sort != "status" || q.Order != "asc" {
		t.Errorf("defaults = %+v, want page=1 pageSize=20 status=\"\" kind=all sort=status order=asc", q)
	}
}

func TestParseCustomerRequestListQuery_HasParamsWhenAnyRecognizedKeyPresent(t *testing.T) {
	cases := []struct {
		name  string
		query url.Values
	}{
		{"page", url.Values{"page": {"2"}}},
		{"pageSize", url.Values{"pageSize": {"50"}}},
		{"status", url.Values{"status": {"pending"}}},
		{"kind", url.Values{"kind": {"song"}}},
		{"q", url.Values{"q": {"napkin"}}},
		{"sort", url.Values{"sort": {"createdAt"}}},
		{"order", url.Values{"order": {"desc"}}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, hasParams, err := parseCustomerRequestListQuery(tc.query)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !hasParams {
				t.Errorf("hasParams = false, want true when %q is present", tc.name)
			}
		})
	}
}

func TestParseCustomerRequestListQuery_ValidValues(t *testing.T) {
	query := url.Values{
		"page":     {"3"},
		"pageSize": {"50"},
		"status":   {"checked"},
		"kind":     {"song"},
		"q":        {"napkin"},
		"sort":     {"createdAt"},
		"order":    {"asc"},
	}

	q, hasParams, err := parseCustomerRequestListQuery(query)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !hasParams {
		t.Error("hasParams = false, want true")
	}
	if q.Page != 3 || q.PageSize != 50 || q.Status != "checked" || q.Kind != "song" ||
		q.Search != "napkin" || q.Sort != "createdAt" || q.Order != "asc" {
		t.Errorf("parsed = %+v, want the given values", q)
	}
}

func TestParseCustomerRequestListQuery_FromTo(t *testing.T) {
	query := url.Values{
		"from": {"2026-01-01T00:00:00Z"},
		"to":   {"2026-01-08T00:00:00Z"},
	}

	q, hasParams, err := parseCustomerRequestListQuery(query)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !hasParams {
		t.Error("hasParams = false, want true when from/to is present")
	}
	wantFrom := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 1, 8, 0, 0, 0, 0, time.UTC)
	if q.From == nil || !q.From.Equal(wantFrom) {
		t.Errorf("From = %v, want %v", q.From, wantFrom)
	}
	if q.To == nil || !q.To.Equal(wantTo) {
		t.Errorf("To = %v, want %v", q.To, wantTo)
	}
}

func TestParseCustomerRequestListQuery_DefaultOrderDependsOnSort(t *testing.T) {
	t.Run("sort=status defaults to asc", func(t *testing.T) {
		q, _, err := parseCustomerRequestListQuery(url.Values{"sort": {"status"}})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if q.Order != "asc" {
			t.Errorf("order = %q, want asc", q.Order)
		}
	})

	t.Run("sort=createdAt defaults to desc", func(t *testing.T) {
		q, _, err := parseCustomerRequestListQuery(url.Values{"sort": {"createdAt"}})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if q.Order != "desc" {
			t.Errorf("order = %q, want desc", q.Order)
		}
	})
}

func TestParseCustomerRequestListQuery_InvalidValuesRejected(t *testing.T) {
	cases := []struct {
		name  string
		query url.Values
	}{
		{"page zero", url.Values{"page": {"0"}}},
		{"page not a number", url.Values{"page": {"abc"}}},
		{"pageSize zero", url.Values{"pageSize": {"0"}}},
		{"pageSize over max", url.Values{"pageSize": {"101"}}},
		{"unknown status", url.Values{"status": {"archived"}}},
		{"unknown kind", url.Values{"kind": {"birthday"}}},
		{"unknown sort", url.Values{"sort": {"id"}}},
		{"unknown order", url.Values{"order": {"random"}}},
		{"unparseable from", url.Values{"from": {"not-a-date"}}},
		{"unparseable to", url.Values{"to": {"not-a-date"}}},
		{"from not before to", url.Values{
			"from": {"2026-01-08T00:00:00Z"},
			"to":   {"2026-01-01T00:00:00Z"},
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := parseCustomerRequestListQuery(tc.query); err == nil {
				t.Errorf("parseCustomerRequestListQuery(%v) returned nil error, want a validation error", tc.query)
			}
		})
	}
}

func TestParseSpecialRequestListQuery_Defaults(t *testing.T) {
	q, hasParams, err := parseSpecialRequestListQuery(url.Values{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if hasParams {
		t.Error("hasParams = true, want false when no recognized query key is present")
	}
	if q.Page != 1 || q.PageSize != 20 || q.Gender != "" || q.Search != "" ||
		q.Sort != "createdAt" || q.Order != "desc" {
		t.Errorf("defaults = %+v, want page=1 pageSize=20 gender=\"\" sort=createdAt order=desc", q)
	}
}

func TestParseSpecialRequestListQuery_ValidValues(t *testing.T) {
	query := url.Values{
		"page":     {"2"},
		"pageSize": {"10"},
		"gender":   {"female"},
		"q":        {"seoul"},
		"sort":     {"name"},
		"order":    {"asc"},
	}

	q, hasParams, err := parseSpecialRequestListQuery(query)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !hasParams {
		t.Error("hasParams = false, want true")
	}
	if q.Page != 2 || q.PageSize != 10 || q.Gender != "female" || q.Search != "seoul" ||
		q.Sort != "name" || q.Order != "asc" {
		t.Errorf("parsed = %+v, want the given values", q)
	}
}

func TestParseSpecialRequestListQuery_FromTo(t *testing.T) {
	query := url.Values{
		"from": {"2026-01-01T00:00:00Z"},
		"to":   {"2026-01-08T00:00:00Z"},
	}

	q, hasParams, err := parseSpecialRequestListQuery(query)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !hasParams {
		t.Error("hasParams = false, want true when from/to is present")
	}
	wantFrom := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 1, 8, 0, 0, 0, 0, time.UTC)
	if q.From == nil || !q.From.Equal(wantFrom) {
		t.Errorf("From = %v, want %v", q.From, wantFrom)
	}
	if q.To == nil || !q.To.Equal(wantTo) {
		t.Errorf("To = %v, want %v", q.To, wantTo)
	}
}

func TestParseSpecialRequestListQuery_InvalidValuesRejected(t *testing.T) {
	cases := []struct {
		name  string
		query url.Values
	}{
		{"unknown gender", url.Values{"gender": {"unspecified"}}},
		{"unknown sort", url.Values{"sort": {"age"}}},
		{"unknown order", url.Values{"order": {"random"}}},
		{"pageSize over max", url.Values{"pageSize": {"101"}}},
		{"unparseable from", url.Values{"from": {"not-a-date"}}},
		{"unparseable to", url.Values{"to": {"not-a-date"}}},
		{"from not before to", url.Values{
			"from": {"2026-01-08T00:00:00Z"},
			"to":   {"2026-01-01T00:00:00Z"},
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := parseSpecialRequestListQuery(tc.query); err == nil {
				t.Errorf("parseSpecialRequestListQuery(%v) returned nil error, want a validation error", tc.query)
			}
		})
	}
}

func TestParsePaymentOrderListQuery_Defaults(t *testing.T) {
	q, err := parsePaymentOrderListQuery(url.Values{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if q.Page != 1 || q.PageSize != 20 || q.Status != "" || q.PosSyncStatus != "" ||
		q.Search != "" || q.Sort != "createdAt" || q.Order != "desc" || q.From != nil || q.To != nil {
		t.Errorf("defaults = %+v, want page=1 pageSize=20 status=\"\" posSync=\"\" sort=createdAt order=desc from=nil to=nil", q)
	}
}

func TestParsePaymentOrderListQuery_ValidValues(t *testing.T) {
	query := url.Values{
		"page":     {"2"},
		"pageSize": {"10"},
		"status":   {"DONE"},
		"posSync":  {"FAILED"},
		"q":        {"T-01"},
		"from":     {"2026-01-01T00:00:00Z"},
		"to":       {"2026-01-02T00:00:00Z"},
		"sort":     {"amount"},
		"order":    {"asc"},
	}

	q, err := parsePaymentOrderListQuery(query)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	wantFrom := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	if q.Page != 2 || q.PageSize != 10 || q.Status != "DONE" || q.PosSyncStatus != "FAILED" ||
		q.Search != "T-01" || q.Sort != "amount" || q.Order != "asc" {
		t.Errorf("parsed = %+v, want the given values", q)
	}
	if q.From == nil || !q.From.Equal(wantFrom) {
		t.Errorf("From = %v, want %v", q.From, wantFrom)
	}
	if q.To == nil || !q.To.Equal(wantTo) {
		t.Errorf("To = %v, want %v", q.To, wantTo)
	}
}

func TestParsePaymentOrderListQuery_AcceptsCancelledStatus(t *testing.T) {
	q, err := parsePaymentOrderListQuery(url.Values{"status": {"CANCELLED"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if q.Status != "CANCELLED" {
		t.Errorf("Status = %q, want CANCELLED", q.Status)
	}
}

func TestParsePaymentOrderListQuery_InvalidValuesRejected(t *testing.T) {
	cases := []struct {
		name  string
		query url.Values
	}{
		{"page zero", url.Values{"page": {"0"}}},
		{"pageSize over max", url.Values{"pageSize": {"101"}}},
		{"unknown status", url.Values{"status": {"CANCELED"}}},
		{"unknown posSync", url.Values{"posSync": {"UNKNOWN"}}},
		{"unknown sort", url.Values{"sort": {"tableNumber"}}},
		{"unknown order", url.Values{"order": {"random"}}},
		{"unparseable from", url.Values{"from": {"not-a-date"}}},
		{"unparseable to", url.Values{"to": {"not-a-date"}}},
		{"from not before to", url.Values{
			"from": {"2026-01-02T00:00:00Z"},
			"to":   {"2026-01-01T00:00:00Z"},
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := parsePaymentOrderListQuery(tc.query); err == nil {
				t.Errorf("parsePaymentOrderListQuery(%v) returned nil error, want a validation error", tc.query)
			}
		})
	}
}

func TestParsePaymentOrderStatsQuery_ValidValues(t *testing.T) {
	query := url.Values{
		"from":     {"2026-01-01T00:00:00Z"},
		"to":       {"2026-02-01T00:00:00Z"},
		"dayBasis": {"business"},
	}

	q, err := parsePaymentOrderStatsQuery(query)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	wantFrom := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	if !q.From.Equal(wantFrom) || !q.To.Equal(wantTo) {
		t.Errorf("parsed = %+v, want From=%v To=%v", q, wantFrom, wantTo)
	}
	if !q.BusinessDayBasis {
		t.Errorf("BusinessDayBasis = false, want true for dayBasis=business")
	}
}

func TestParsePaymentOrderStatsQuery_DayBasisDefaultsToCalendar(t *testing.T) {
	query := url.Values{
		"from": {"2026-01-01T00:00:00Z"},
		"to":   {"2026-02-01T00:00:00Z"},
	}

	q, err := parsePaymentOrderStatsQuery(query)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if q.BusinessDayBasis {
		t.Error("BusinessDayBasis = true, want false when dayBasis is omitted")
	}
}

func TestParsePaymentOrderStatsQuery_DayBasisCalendarIsExplicitlyFalse(t *testing.T) {
	query := url.Values{
		"from":     {"2026-01-01T00:00:00Z"},
		"to":       {"2026-02-01T00:00:00Z"},
		"dayBasis": {"calendar"},
	}

	q, err := parsePaymentOrderStatsQuery(query)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if q.BusinessDayBasis {
		t.Error("BusinessDayBasis = true, want false for dayBasis=calendar")
	}
}

func TestParsePaymentOrderStatsQuery_InvalidValuesRejected(t *testing.T) {
	cases := []struct {
		name  string
		query url.Values
	}{
		{"missing from", url.Values{"to": {"2026-02-01T00:00:00Z"}}},
		{"missing to", url.Values{"from": {"2026-01-01T00:00:00Z"}}},
		{"missing both", url.Values{}},
		{"unparseable from", url.Values{"from": {"nope"}, "to": {"2026-02-01T00:00:00Z"}}},
		{"unparseable to", url.Values{"from": {"2026-01-01T00:00:00Z"}, "to": {"nope"}}},
		{"from not before to", url.Values{
			"from": {"2026-02-01T00:00:00Z"},
			"to":   {"2026-01-01T00:00:00Z"},
		}},
		{"from equal to", url.Values{
			"from": {"2026-01-01T00:00:00Z"},
			"to":   {"2026-01-01T00:00:00Z"},
		}},
		{"unknown dayBasis", url.Values{
			"from":     {"2026-01-01T00:00:00Z"},
			"to":       {"2026-02-01T00:00:00Z"},
			"dayBasis": {"lunar"},
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := parsePaymentOrderStatsQuery(tc.query); err == nil {
				t.Errorf("parsePaymentOrderStatsQuery(%v) returned nil error, want a validation error", tc.query)
			}
		})
	}
}
