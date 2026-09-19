package store

import "testing"

func TestQrTableIDFromPOSTitle(t *testing.T) {
	cases := []struct {
		title string
		want  string
		ok    bool
	}{
		{"t11", "T-11", true},
		{"T11", "T-11", true},
		{"t-1", "T-01", true},
		{"T-01", "T-01", true},
		{"t_2", "T-02", true},
		{"테이블11", "T-11", true},
		{"테이블 11", "T-11", true},
		{"테이블01", "T-01", true},
		{" 테이블-3 ", "T-03", true},
		{"b3", "B-03", true},
		{"B-05", "B-05", true},
		{"바3", "B-03", true},
		{"바 3", "B-03", true},
		{"바자리3", "B-03", true},
		{"바자리 03", "B-03", true},
		{"룸1", "", false},
		{"테라스", "", false},
		{"테라스2", "", false},
		{"", "", false},
		{"t", "", false},
		{"t0", "", false},
		{"바0", "", false},
		{"t100", "", false},
		{"테이블100", "", false},
	}

	for _, tc := range cases {
		got, ok := qrTableIDFromPOSTitle(tc.title)
		if ok != tc.ok || got != tc.want {
			t.Errorf("qrTableIDFromPOSTitle(%q) = (%q, %v), want (%q, %v)", tc.title, got, ok, tc.want, tc.ok)
		}
	}
}

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
