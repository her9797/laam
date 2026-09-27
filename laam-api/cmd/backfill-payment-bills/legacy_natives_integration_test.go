package main

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Before moves were tracked, a web item moved by "한 번에 결제" from POS
// order X to Y was recorded AGAIN on Y as a POS-native row (menu_item_id
// NULL, DONE), while the web row stayed READY on X. The backfill replaces
// such a legacy native row with the moved web row.

func lineItemWithOptionJSON(title string, category string, price int64, option string, optionPrice int64) string {
	return `{"item":{"title":"` + title + `","category":{"title":"` + category + `"}},"itemPrice":{"priceValue":` + itoa(price) +
		`},"quantity":1,"optionChoices":[{"title":"` + option + `","priceValue":` + itoa(optionPrice) + `,"quantity":1}]}`
}

func seedMenuItem(t *testing.T, id string, name string) {
	t.Helper()
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO menu_categories (id, label, sort_order) VALUES ('cat-whisky', '위스키', 1) ON CONFLICT (id) DO NOTHING
	`); err != nil {
		t.Fatalf("seed menu_categories: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO menu_items (id, category_id, name, description, price, sort_order)
		VALUES ($1, 'cat-whisky', $2, '', '10,000', 1) ON CONFLICT (id) DO NOTHING
	`, id, name); err != nil {
		t.Fatalf("seed menu_items %q: %v", id, err)
	}
}

func seedWebRow(t *testing.T, id string, menuItemID string, posOrderID string, name string, amount int64, status string, createdAt time.Time) {
	t.Helper()
	seedMenuItem(t, menuItemID, name)
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO payment_orders (id, menu_item_id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, pos_order_id, created_at)
		VALUES ($1, $2, $3, '위스키', 'N-01', $4, $5, 'SUCCEEDED', $6, $7)
	`, id, menuItemID, name, amount, status, posOrderID, createdAt); err != nil {
		t.Fatalf("seed web row %q: %v", id, err)
	}
}

// seedLegacyNative seeds a row the old code recorded for a POS line: no
// menu item, DONE, paid by POS, no table.
func seedLegacyNative(t *testing.T, id string, posOrderID string, name string, amount int64, createdAt time.Time) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO payment_orders (id, menu_item_name, category_name, table_number, amount, status, payment_method, approved_at,
			vat, supplied_amount, pos_sync_status, pos_order_id, created_at)
		VALUES ($1, $2, '위스키', '', $3, 'DONE', 'POS', $4, $5, $6, 'SUCCEEDED', $7, $4)
	`, id, name, amount, createdAt, amount/11, amount-amount/11, posOrderID); err != nil {
		t.Fatalf("seed legacy native %q: %v", id, err)
	}
}

// seedLegacyJameson is the real case: web 제임슨 READY on X (paid on Y via
// "한 번에 결제"), and on Y the old code's native rows 조니워커 블랙 + 제임슨.
// nativesAt decides whether Y (earlier) or X (later) is processed first.
func seedLegacyJameson(t *testing.T, fake *fakeTossPlace, nativesAt time.Time) {
	t.Helper()
	seedWebRow(t, "order-jameson", "menu-jameson", "pos-x", "제임슨", 10000, "READY", time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC))
	seedLegacyNative(t, "native-johnnie", "pos-y", "조니워커 블랙", 11000, nativesAt)
	seedLegacyNative(t, "native-jameson", "pos-y", "제임슨", 10000, nativesAt.Add(time.Second))

	fake.setOrderJSON("pos-x", `{"id":"pos-x","orderState":"COMPLETED","completedAt":"2026-09-01T13:00:00Z",`+
		`"chargePrice":{"totalAmount":15000,"discountAmount":0},"lineItems":[`+lineItemJSON("고독", "기타", 15000, 1)+`]}`,
		`[`+paymentJSON("pay-x", "APPROVED", "ACCOUNT_TRANSFER", 15000, "2026-09-01T13:00:00Z", "")+`]`)
	fake.setOrderJSON("pos-y", `{"id":"pos-y","orderState":"COMPLETED","completedAt":"2026-09-01T12:30:00Z",`+
		`"chargePrice":{"totalAmount":21000,"discountAmount":0},"lineItems":[`+
		lineItemWithOptionJSON("조니워커 블랙", "위스키", 11000, "니트", 0)+`,`+
		lineItemWithOptionJSON("제임슨", "위스키", 10000, "니트", 0)+`]}`,
		`[`+paymentJSON("pay-y", "APPROVED", "CARD", 21000, "2026-09-01T12:30:00Z", "")+`]`)
}

func assertLegacyJamesonReplaced(t *testing.T) {
	t.Helper()
	ctx := context.Background()

	var jamesons int
	var id, status, posOrderID, origin, billOf string
	if err := testPool.QueryRow(ctx, `
		SELECT COUNT(*) OVER (), o.id, o.status, o.pos_order_id, COALESCE(o.pos_origin_order_id, ''), COALESCE(b.pos_order_id, '')
		FROM payment_orders o LEFT JOIN pos_bills b ON b.id = o.bill_id
		WHERE o.menu_item_name = '제임슨'
	`).Scan(&jamesons, &id, &status, &posOrderID, &origin, &billOf); err != nil {
		t.Fatalf("read 제임슨 rows: %v", err)
	}
	if jamesons != 1 || id != "order-jameson" || status != "DONE" || posOrderID != "pos-y" || origin != "pos-x" || billOf != "pos-y" {
		t.Fatalf("제임슨 rows = %d, first %s %s on %s (origin %q, bill of %q); want only order-jameson DONE on pos-y from pos-x in Y's bill",
			jamesons, id, status, posOrderID, origin, billOf)
	}

	for _, want := range []struct{ name, posOrderID string }{{"조니워커 블랙", "pos-y"}, {"고독", "pos-x"}} {
		var count int
		if err := testPool.QueryRow(ctx, `
			SELECT COUNT(*) FROM payment_orders o JOIN pos_bills b ON b.id = o.bill_id
			WHERE o.menu_item_name = $1 AND o.menu_item_id IS NULL AND o.status = 'DONE' AND o.pos_order_id = $2 AND b.pos_order_id = $2
		`, want.name, want.posOrderID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("%s native rows on %s = %d, want 1", want.name, want.posOrderID, count)
		}
	}

	var unpaid int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM payment_orders WHERE status IN ('READY', 'ACKNOWLEDGED')`).Scan(&unpaid); err != nil {
		t.Fatal(err)
	}
	if unpaid != 0 {
		t.Fatalf("READY/ACKNOWLEDGED rows = %d, want none", unpaid)
	}

	for posOrderID, want := range map[string]int64{"pos-x": 15000, "pos-y": 21000} {
		var paid, rowsSum int64
		bill := loadBill(t, posOrderID)
		if err := testPool.QueryRow(ctx, `
			SELECT COALESCE((SELECT SUM(amount) FROM pos_payments WHERE bill_id = $1 AND state = 'APPROVED'), 0),
				COALESCE((SELECT SUM(amount) FROM payment_orders WHERE bill_id = $1 AND status = 'DONE'), 0)
		`, bill.ID).Scan(&paid, &rowsSum); err != nil {
			t.Fatal(err)
		}
		if paid != want || rowsSum != want || bill.Status != "PAID" || !bill.Synced {
			t.Fatalf("%s: payments %d, DONE rows %d, bill %+v; want %d PAID synced", posOrderID, paid, rowsSum, bill, want)
		}
	}
}

func TestBackfill_LegacyDuplicateNativeReplacedByMovedWebRow(t *testing.T) {
	for _, tc := range []struct {
		name      string
		nativesAt time.Time
		first     string
	}{
		{"X processed first", time.Date(2026, 9, 1, 12, 20, 0, 0, time.UTC), "pos-x"},
		{"Y processed first", time.Date(2026, 9, 1, 11, 50, 0, 0, time.UTC), "pos-y"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetTables(t)
			fake, server := newFakeTossPlace(t)
			seedLegacyJameson(t, fake, tc.nativesAt)
			cfg := testConfig(server.URL)
			before := snapshotDB(t)

			code, out := runBackfill(t, cfg)
			t.Logf("dry-run output:\n%s", out)
			if code != 0 {
				t.Fatalf("dry-run exit code = %d, output:\n%s", code, out)
			}
			after := snapshotDB(t)
			if after.Bills != 0 || after.Payments != 0 || len(after.Rows) != len(before.Rows) {
				t.Fatalf("dry-run wrote: bills=%d payments=%d rows %d -> %d", after.Bills, after.Payments, len(before.Rows), len(after.Rows))
			}
			for id, row := range before.Rows {
				if after.Rows[id] != row {
					t.Fatalf("dry-run changed %s: %q -> %q", id, row, after.Rows[id])
				}
			}
			if !strings.Contains(out, "pos_order_id="+tc.first) || strings.Index(out, "pos_order_id="+tc.first) > strings.Index(out, "pos_order_id=pos-") {
				t.Fatalf("expected %s to be processed first:\n%s", tc.first, out)
			}
			for _, want := range []string{
				"replaced_natives=1[order-jameson<-native-jameson]",
				"replaced_natives=1 amount=10000",
			} {
				if !strings.Contains(out, want) {
					t.Errorf("dry-run output missing %q:\n%s", want, out)
				}
			}

			code, out = runBackfill(t, cfg, "--apply")
			t.Logf("apply output:\n%s", out)
			if code != 0 {
				t.Fatalf("apply exit code = %d, output:\n%s", code, out)
			}
			assertLegacyJamesonReplaced(t)
			applied := snapshotDB(t)

			code, out = runBackfill(t, cfg, "--apply")
			if code != 0 {
				t.Fatalf("second apply exit code = %d, output:\n%s", code, out)
			}
			if !strings.Contains(out, "replaced_natives=0 amount=0") || strings.Contains(out, "replaced_natives=1") {
				t.Errorf("second apply should replace nothing:\n%s", out)
			}
			rerun := snapshotDB(t)
			if len(rerun.Rows) != len(applied.Rows) || rerun.Bills != applied.Bills || rerun.Payments != applied.Payments {
				t.Fatalf("second apply changed counts: %+v -> %+v", applied, rerun)
			}
			for id, row := range applied.Rows {
				if rerun.Rows[id] != row {
					t.Fatalf("second apply changed %s: %q -> %q", id, row, rerun.Rows[id])
				}
			}
			assertLegacyJamesonReplaced(t)
		})
	}
}

// A legacy native whose web counterpart is still on its own (open) POS
// order was not a duplicate of a moved item: it stays.
func TestBackfill_LegacyNativeWithoutMovedWebRowIsUntouched(t *testing.T) {
	resetTables(t)
	fake, server := newFakeTossPlace(t)
	seedWebRow(t, "order-jameson", "menu-jameson", "pos-x", "제임슨", 10000, "READY", time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC))
	nativesAt := time.Date(2026, 9, 1, 12, 20, 0, 0, time.UTC)
	seedLegacyNative(t, "native-johnnie", "pos-y", "조니워커 블랙", 11000, nativesAt)
	seedLegacyNative(t, "native-jameson", "pos-y", "제임슨", 10000, nativesAt.Add(time.Second))
	fake.setOrderJSON("pos-x", `{"id":"pos-x","orderState":"OPENED","chargePrice":{"totalAmount":10000,"discountAmount":0},"lineItems":[`+
		lineItemJSON("제임슨", "위스키", 10000, 1)+`]}`, `[]`)
	fake.setOrderJSON("pos-y", `{"id":"pos-y","orderState":"COMPLETED","completedAt":"2026-09-01T12:30:00Z",`+
		`"chargePrice":{"totalAmount":21000,"discountAmount":0},"lineItems":[`+
		lineItemJSON("조니워커 블랙", "위스키", 11000, 1)+`,`+lineItemJSON("제임슨", "위스키", 10000, 1)+`]}`,
		`[`+paymentJSON("pay-y", "APPROVED", "CARD", 21000, "2026-09-01T12:30:00Z", "")+`]`)

	code, out := runBackfill(t, testConfig(server.URL), "--apply")
	if code != 0 {
		t.Fatalf("apply exit code = %d, output:\n%s", code, out)
	}
	if !strings.Contains(out, "replaced_natives=0 amount=0") {
		t.Errorf("output should report no replacement:\n%s", out)
	}
	if status := rowStatus(t, "native-jameson"); status != "DONE" {
		t.Fatalf("native-jameson status = %q, want untouched DONE", status)
	}
	if status := rowStatus(t, "order-jameson"); status != "READY" {
		t.Fatalf("order-jameson status = %q, want READY on its open POS order", status)
	}
}
