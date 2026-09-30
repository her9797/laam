package store

import "testing"

func TestParseQrTableID(t *testing.T) {
	cases := []struct {
		id     string
		area   string
		number int
		ok     bool
	}{
		{"T-01", "T", 1, true},
		{"B-05", "B", 5, true},
		{"T-10", "T", 10, true},
		{"R-99", "R", 99, true},
		{"t-01", "", 0, false},
		{"T-1", "", 0, false},
		{"T-001", "", 0, false},
		{"T01", "", 0, false},
		{"T-00", "", 0, false},
		{"", "", 0, false},
		{"TT-01", "", 0, false},
	}

	for _, tc := range cases {
		area, number, ok := parseQrTableID(tc.id)
		if ok != tc.ok || area != tc.area || number != tc.number {
			t.Errorf("parseQrTableID(%q) = (%q, %d, %v), want (%q, %d, %v)", tc.id, area, number, ok, tc.area, tc.number, tc.ok)
		}
	}
}
