package store

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestNullable(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  any
	}{
		{"empty string becomes nil", "", nil},
		{"whitespace-only string becomes nil", "   ", nil},
		{"non-empty string is preserved", "badge", "badge"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := nullable(tc.input)
			if got != tc.want {
				t.Errorf("nullable(%q) = %v, want %v", tc.input, got, tc.want)
			}
		})
	}
}

func TestClampImageFocus(t *testing.T) {
	cases := []struct {
		name  string
		input int
		want  int
	}{
		{"below range clamps to 0", -10, 0},
		{"above range clamps to 100", 150, 100},
		{"in range is unchanged", 42, 42},
		{"lower boundary is unchanged", 0, 0},
		{"upper boundary is unchanged", 100, 100},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := clampImageFocus(tc.input)
			if got != tc.want {
				t.Errorf("clampImageFocus(%d) = %d, want %d", tc.input, got, tc.want)
			}
		})
	}
}

func TestIsValidCustomerRequestStatus(t *testing.T) {
	cases := []struct {
		status string
		want   bool
	}{
		{"pending", true},
		{"checked", true},
		{"completed", true},
		{"cancelled", false},
		{"", false},
	}

	for _, tc := range cases {
		t.Run(tc.status, func(t *testing.T) {
			if got := isValidCustomerRequestStatus(tc.status); got != tc.want {
				t.Errorf("isValidCustomerRequestStatus(%q) = %v, want %v", tc.status, got, tc.want)
			}
		})
	}
}

func TestIsValidSongPlaybackStatus(t *testing.T) {
	tests := []struct {
		status string
		want   bool
	}{
		{status: "playing", want: true},
		{status: "completed", want: true},
		{status: "queued", want: false},
		{status: "pending", want: false},
		{status: "", want: false},
	}

	for _, tc := range tests {
		t.Run(tc.status, func(t *testing.T) {
			if got := isValidSongPlaybackStatus(tc.status); got != tc.want {
				t.Errorf("isValidSongPlaybackStatus(%q) = %v, want %v", tc.status, got, tc.want)
			}
		})
	}
}

func TestIsValidCustomerRequestGender(t *testing.T) {
	cases := []struct {
		gender string
		want   bool
	}{
		{"male", true},
		{"female", true},
		{"other", false},
		{"", false},
	}

	for _, tc := range cases {
		t.Run(tc.gender, func(t *testing.T) {
			if got := isValidCustomerRequestGender(tc.gender); got != tc.want {
				t.Errorf("isValidCustomerRequestGender(%q) = %v, want %v", tc.gender, got, tc.want)
			}
		})
	}
}

func TestFormatTimestamp(t *testing.T) {
	loc := time.FixedZone("KST", 9*60*60)
	input := time.Date(2026, 9, 4, 21, 30, 0, 0, loc)

	got := formatTimestamp(input)
	want := "2026-09-04T12:30:00Z"

	if got != want {
		t.Errorf("formatTimestamp(%v) = %q, want %q (should normalize to UTC)", input, got, want)
	}
}

func TestNextID(t *testing.T) {
	t.Run("includes the given prefix", func(t *testing.T) {
		id := nextID("menu")
		if !strings.HasPrefix(id, "menu-") {
			t.Errorf("nextID(%q) = %q, want prefix %q", "menu", id, "menu-")
		}
	})

	t.Run("never repeats across rapid successive calls, even within the same nanosecond", func(t *testing.T) {
		// CreateCustomerRequest (and every other Create*) used to derive its
		// id from time.Now().UnixMilli() alone: two calls landing in the same
		// millisecond produced the same id and the second insert failed with
		// ErrAlreadyExists. This reproduces that race deterministically by
		// calling nextID in a tight loop instead of relying on CI timing luck.
		const n = 10000
		seen := make(map[string]bool, n)
		for i := 0; i < n; i++ {
			id := nextID("x")
			if seen[id] {
				t.Fatalf("nextID() produced a duplicate id %q after %d calls", id, i)
			}
			seen[id] = true
		}
	})
}

func TestClassifyError(t *testing.T) {
	t.Run("nil error stays nil", func(t *testing.T) {
		if err := classifyError(nil); err != nil {
			t.Errorf("classifyError(nil) = %v, want nil", err)
		}
	})

	t.Run("unique violation maps to ErrAlreadyExists", func(t *testing.T) {
		pgErr := &pgconn.PgError{Code: "23505"}
		if err := classifyError(pgErr); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("classifyError(unique violation) = %v, want ErrAlreadyExists", err)
		}
	})

	t.Run("other postgres error codes pass through unchanged", func(t *testing.T) {
		pgErr := &pgconn.PgError{Code: "23503"}
		got := classifyError(pgErr)
		if !errors.Is(got, pgErr) {
			t.Errorf("classifyError(foreign key violation) = %v, want unchanged pgErr", got)
		}
	})

	t.Run("pgx.ErrNoRows maps to ErrNotFound", func(t *testing.T) {
		if err := classifyError(pgx.ErrNoRows); !errors.Is(err, ErrNotFound) {
			t.Errorf("classifyError(pgx.ErrNoRows) = %v, want ErrNotFound", err)
		}
	})

	t.Run("unrelated error passes through unchanged", func(t *testing.T) {
		sentinel := errors.New("boom")
		if err := classifyError(sentinel); !errors.Is(err, sentinel) {
			t.Errorf("classifyError(sentinel) = %v, want unchanged sentinel", err)
		}
	})
}
