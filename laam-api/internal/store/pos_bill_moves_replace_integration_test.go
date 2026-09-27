package store

import (
	"context"
	"testing"
	"time"
)

// Legacy data: before moves were tracked, a web item moved from POS order X
// to Y by "한 번에 결제" was recorded again on Y as a POS-native row while the
// web row stayed READY on X. ReplaceNatives swaps such a native for the web
// row in the completion's transaction.

func seedReplaceMenuItem(t *testing.T, ctx context.Context, rowID string, menuItemID string) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO menu_categories (id, label, sort_order) VALUES ('cat-replace', '위스키', 1) ON CONFLICT (id) DO NOTHING
	`); err != nil {
		t.Fatalf("seed menu_categories: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO menu_items (id, category_id, name, description, price, sort_order)
		VALUES ($1, 'cat-replace', $1, '', '10,000', 1) ON CONFLICT (id) DO NOTHING
	`, menuItemID); err != nil {
		t.Fatalf("seed menu_items: %v", err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE payment_orders SET menu_item_id = $2 WHERE id = $1`, rowID, menuItemID); err != nil {
		t.Fatalf("link %q to menu item: %v", rowID, err)
	}
}

// seedLegacyReplaceCase: web 제임슨 READY on X (menu item set); on Y the
// old code's native 제임슨 and 조니워커 (menu_item_id NULL, DONE).
func seedLegacyReplaceCase(t *testing.T, ctx context.Context) {
	t.Helper()
	resetPaymentOrdersTable(t, ctx)
	seedMoveRow(t, ctx, "w-jameson", "pos-x", "제임슨", 10000, "READY", moveBase)
	seedReplaceMenuItem(t, ctx, "w-jameson", "menu-jameson")
	seedMoveRow(t, ctx, "n-johnnie", "pos-y", "조니워커 블랙", 11000, "DONE", moveBase.Add(time.Minute))
	seedMoveRow(t, ctx, "n-jameson", "pos-y", "제임슨", 10000, "DONE", moveBase.Add(2*time.Minute))
}

func legacyReplaceYInput(pairs ...POSNativeReplacement) ApplyPOSCompletionInput {
	return ApplyPOSCompletionInput{
		POSOrderID:     "pos-y",
		CompletedAt:    moveBase.Add(time.Hour),
		CompleteRowIDs: []string{"n-johnnie", "n-jameson"},
		TotalAmount:    int64Ptr(21000),
		DiscountAmount: int64Ptr(0),
		ReplaceNatives: pairs,
	}
}

func rowExists(t *testing.T, ctx context.Context, id string) bool {
	t.Helper()
	var exists bool
	if err := testPool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM payment_orders WHERE id = $1)`, id).Scan(&exists); err != nil {
		t.Fatalf("check %q: %v", id, err)
	}
	return exists
}

func TestRepository_ApplyPOSCompletion_ReplacesLegacyNativeWithMovedWebRow(t *testing.T) {
	ctx := context.Background()
	seedLegacyReplaceCase(t, ctx)

	onX, err := testRepo.ListPOSRowsOnOrder(ctx, "pos-x")
	if err != nil {
		t.Fatalf("ListPOSRowsOnOrder(pos-x) error = %v", err)
	}
	if len(onX) != 1 || onX[0].MenuItemID != "menu-jameson" {
		t.Fatalf("rows on pos-x = %+v, want web 제임슨 with its menu item id", onX)
	}

	input := legacyReplaceYInput(POSNativeReplacement{NativeRowID: "n-jameson", WebRowID: "w-jameson"})
	for i := 0; i < 2; i++ {
		billY, err := testRepo.ApplyPOSCompletion(ctx, input)
		if err != nil {
			t.Fatalf("ApplyPOSCompletion(Y) #%d error = %v", i, err)
		}
		if rowExists(t, ctx, "n-jameson") {
			t.Fatalf("#%d: legacy native 제임슨 still exists, want deleted", i)
		}
		jameson := readMoveRow(t, ctx, "w-jameson")
		if jameson.Status != "DONE" || jameson.POSOrderID != "pos-y" || jameson.Origin != "pos-x" || jameson.BillID != billY || jameson.Method != "POS" {
			t.Fatalf("#%d: 제임슨 = %+v, want DONE on pos-y from pos-x in bill %s", i, jameson, billY)
		}
		if got, want := billLines(t, ctx, "pos-y"), []string{"제임슨/DONE", "조니워커 블랙/DONE"}; !equalStrings(got, want) {
			t.Fatalf("#%d: bill Y lines = %v, want %v", i, got, want)
		}
	}
}

func TestRepository_ApplyPOSCompletion_SkipsReplacementThatNoLongerHolds(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name  string
		setup func(t *testing.T)
		pair  POSNativeReplacement
	}{
		{"native row has a menu item", func(t *testing.T) { seedReplaceMenuItem(t, ctx, "n-jameson", "menu-jameson") },
			POSNativeReplacement{NativeRowID: "n-jameson", WebRowID: "w-jameson"}},
		{"native row is on another POS order", func(t *testing.T) {
			if _, err := testPool.Exec(ctx, `UPDATE payment_orders SET pos_order_id = 'pos-z' WHERE id = 'n-jameson'`); err != nil {
				t.Fatal(err)
			}
		}, POSNativeReplacement{NativeRowID: "n-jameson", WebRowID: "w-jameson"}},
		{"native row is not DONE", func(t *testing.T) {
			if _, err := testPool.Exec(ctx, `UPDATE payment_orders SET status = 'CANCELLED' WHERE id = 'n-jameson'`); err != nil {
				t.Fatal(err)
			}
		}, POSNativeReplacement{NativeRowID: "n-jameson", WebRowID: "w-jameson"}},
		{"web row already paid", func(t *testing.T) {
			if _, err := testPool.Exec(ctx, `UPDATE payment_orders SET status = 'DONE' WHERE id = 'w-jameson'`); err != nil {
				t.Fatal(err)
			}
		}, POSNativeReplacement{NativeRowID: "n-jameson", WebRowID: "w-jameson"}},
		{"web row has no menu item", func(t *testing.T) {
			if _, err := testPool.Exec(ctx, `UPDATE payment_orders SET menu_item_id = NULL WHERE id = 'w-jameson'`); err != nil {
				t.Fatal(err)
			}
		}, POSNativeReplacement{NativeRowID: "n-jameson", WebRowID: "w-jameson"}},
		{"different menu", func(t *testing.T) {}, POSNativeReplacement{NativeRowID: "n-johnnie", WebRowID: "w-jameson"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			seedLegacyReplaceCase(t, ctx)
			tc.setup(t)
			var webBefore string
			if err := testPool.QueryRow(ctx, `SELECT status || '/' || pos_order_id FROM payment_orders WHERE id = 'w-jameson'`).Scan(&webBefore); err != nil {
				t.Fatal(err)
			}

			if _, err := testRepo.ApplyPOSCompletion(ctx, legacyReplaceYInput(tc.pair)); err != nil {
				t.Fatalf("ApplyPOSCompletion(Y) error = %v", err)
			}
			if !rowExists(t, ctx, tc.pair.NativeRowID) {
				t.Fatalf("%s deleted, want the replacement skipped", tc.pair.NativeRowID)
			}
			var webAfter string
			if err := testPool.QueryRow(ctx, `SELECT status || '/' || pos_order_id FROM payment_orders WHERE id = 'w-jameson'`).Scan(&webAfter); err != nil {
				t.Fatal(err)
			}
			if webAfter != webBefore {
				t.Fatalf("web row %s -> %s, want untouched", webBefore, webAfter)
			}
		})
	}
}
