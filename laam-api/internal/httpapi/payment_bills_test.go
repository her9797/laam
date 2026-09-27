package httpapi

import (
	"net/url"
	"testing"
	"time"
)

func TestParsePaymentBillListQuery_Defaults(t *testing.T) {
	q, err := parsePaymentBillListQuery(url.Values{})
	if err != nil {
		t.Fatalf("parsePaymentBillListQuery() error = %v", err)
	}
	if q.Page != 1 || q.PageSize != 20 || q.Status != "" || q.SourceType != "" || q.Search != "" || q.From != nil || q.To != nil {
		t.Fatalf("defaults = %+v", q)
	}
}

func TestParsePaymentBillListQuery_ParsesEveryFilter(t *testing.T) {
	q, err := parsePaymentBillListQuery(url.Values{
		"page":       {"2"},
		"pageSize":   {"50"},
		"status":     {"PAID"},
		"sourceType": {"CARD"},
		"q":          {"T-03"},
		"from":       {"2026-01-10T00:00:00+09:00"},
		"to":         {"2026-01-11T00:00:00+09:00"},
	})
	if err != nil {
		t.Fatalf("parsePaymentBillListQuery() error = %v", err)
	}
	wantFrom := time.Date(2026, 1, 9, 15, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 1, 10, 15, 0, 0, 0, time.UTC)
	if q.Page != 2 || q.PageSize != 50 || q.Status != "PAID" || q.SourceType != "CARD" || q.Search != "T-03" ||
		q.From == nil || !q.From.Equal(wantFrom) || q.To == nil || !q.To.Equal(wantTo) {
		t.Fatalf("parsed = %+v", q)
	}
}

func TestParsePaymentBillListQuery_RejectsInvalidValues(t *testing.T) {
	cases := map[string]url.Values{
		"unknown status":      {"status": {"DONE"}},
		"lowercase status":    {"status": {"paid"}},
		"unknown sourceType":  {"sourceType": {"POS"}},
		"page below one":      {"page": {"0"}},
		"pageSize over limit": {"pageSize": {"101"}},
		"bad from":            {"from": {"yesterday"}},
		"inverted range":      {"from": {"2026-01-11T00:00:00Z"}, "to": {"2026-01-10T00:00:00Z"}},
	}
	for name, values := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parsePaymentBillListQuery(values); err == nil {
				t.Fatalf("parsePaymentBillListQuery(%v) error = nil, want an error", values)
			}
		})
	}
}

func TestParsePaymentBillListQuery_AcceptsEveryPaymentSourceType(t *testing.T) {
	for _, sourceType := range []string{"CASH", "CARD", "PREPAID_VALUE", "ACCOUNT_TRANSFER", "BARCODE", "EXTERNAL", "UNDEFINED"} {
		q, err := parsePaymentBillListQuery(url.Values{"sourceType": {sourceType}})
		if err != nil || q.SourceType != sourceType {
			t.Errorf("sourceType %q => %+v, %v", sourceType, q, err)
		}
	}
}
