package store

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

// The list-page WHERE clauses are assembled from whitelisted fragments so an
// unset filter contributes no predicate at all. The previous
// "($1 = '' OR status = $1)" form made PostgreSQL's generic prepared-statement
// plan unable to use the status/created_at indexes; these tests pin that an
// unset filter never reaches SQL and that every value stays a bound parameter.

func assertNoCatchAllPredicate(t *testing.T, where string) {
	t.Helper()
	for _, fragment := range []string{"= ''", "IS NULL OR"} {
		if strings.Contains(where, fragment) {
			t.Errorf("where clause %q still contains catch-all predicate %q", where, fragment)
		}
	}
}

func TestCustomerRequestFilterWhereClause_EmptyFilterHasNoPredicates(t *testing.T) {
	where, args, err := customerRequestFilterWhereClause(CustomerRequestFilter{Kind: "all"})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if strings.TrimSpace(where) != "" {
		t.Errorf("where = %q, want empty", where)
	}
	if len(args) != 0 {
		t.Errorf("args = %v, want none", args)
	}
}

func TestCustomerRequestFilterWhereClause_BindsEveryValue(t *testing.T) {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	injection := "pending' OR 1=1 --"

	where, args, err := customerRequestFilterWhereClause(CustomerRequestFilter{
		Status: injection,
		Kind:   "song",
		Search: "50%_x",
		From:   &from,
		To:     &to,
	})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	assertNoCatchAllPredicate(t, where)
	if strings.Contains(where, injection) || strings.Contains(where, "50") {
		t.Fatalf("where = %q leaks a raw value into SQL", where)
	}
	for _, want := range []string{"status = $1", "starts_with(text, $2)", "text ILIKE $3", "table_number ILIKE $3", "created_at >= $4", "created_at < $5"} {
		if !strings.Contains(where, want) {
			t.Errorf("where = %q, want it to contain %q", where, want)
		}
	}
	wantArgs := []any{injection, songRequestPrefix, `%50\%\_x%`, &from, &to}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Errorf("args = %#v, want %#v", args, wantArgs)
	}
}

func TestCustomerRequestFilterWhereClause_GeneralKindNegatesSongPrefix(t *testing.T) {
	where, args, err := customerRequestFilterWhereClause(CustomerRequestFilter{Kind: "general"})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if !strings.Contains(where, "NOT starts_with(text, $1)") {
		t.Errorf("where = %q, want NOT starts_with(text, $1)", where)
	}
	if !reflect.DeepEqual(args, []any{songRequestPrefix}) {
		t.Errorf("args = %#v", args)
	}
}

func TestCustomerRequestFilterWhereClause_RejectsUnknownKind(t *testing.T) {
	_, _, err := customerRequestFilterWhereClause(CustomerRequestFilter{Kind: "song' OR TRUE --"})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestSpecialRequestFilterWhereClause(t *testing.T) {
	where, args := specialRequestFilterWhereClause(SpecialRequestFilter{})
	if strings.TrimSpace(where) != "" || len(args) != 0 {
		t.Errorf("empty filter: where = %q args = %v, want none", where, args)
	}

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	where, args = specialRequestFilterWhereClause(SpecialRequestFilter{Gender: "female", Search: "kim", From: &from})
	assertNoCatchAllPredicate(t, where)
	for _, want := range []string{"gender = $1", "name ILIKE $2", "text ILIKE $2", "created_at >= $3"} {
		if !strings.Contains(where, want) {
			t.Errorf("where = %q, want it to contain %q", where, want)
		}
	}
	if strings.Contains(where, "created_at <") {
		t.Errorf("where = %q has an upper bound that was not requested", where)
	}
	if !reflect.DeepEqual(args, []any{"female", "%kim%", &from}) {
		t.Errorf("args = %#v", args)
	}
}

func TestPaymentOrderFilterWhereClause(t *testing.T) {
	where, args := paymentOrderFilterWhereClause(PaymentOrderFilter{})
	if strings.TrimSpace(where) != "" || len(args) != 0 {
		t.Errorf("empty filter: where = %q args = %v, want none", where, args)
	}

	to := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	where, args = paymentOrderFilterWhereClause(PaymentOrderFilter{Status: "DONE", PosSyncStatus: "FAILED", To: &to, Search: "T-01"})
	assertNoCatchAllPredicate(t, where)
	for _, want := range []string{"status = $1", "pos_sync_status = $2", "created_at < $3", "table_number ILIKE $4", "menu_item_name ILIKE $4"} {
		if !strings.Contains(where, want) {
			t.Errorf("where = %q, want it to contain %q", where, want)
		}
	}
	if !reflect.DeepEqual(args, []any{"DONE", "FAILED", &to, "%T-01%"}) {
		t.Errorf("args = %#v", args)
	}
}
