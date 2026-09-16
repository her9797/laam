package store

import (
	"context"
	"testing"
	"time"
)

// seedPaymentOrder inserts a payment_orders row directly via SQL rather than
// through CreatePaymentOrder/CompletePaymentOrder, which both require a real
// menu item with a toss_catalog_item_id to exist first. ListPaymentOrdersPage
// only reads this table, so seeding it directly keeps these tests focused on
// the filter/sort/paginate logic under test instead of catalog setup.
func seedPaymentOrder(t *testing.T, ctx context.Context, o struct {
	ID            string
	TableNumber   string
	MenuItemName  string
	CategoryName  string
	Amount        int64
	Status        string
	PosSyncStatus string
	CreatedAt     time.Time
}) {
	t.Helper()
	_, err := testPool.Exec(ctx, `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, o.ID, o.MenuItemName, o.CategoryName, o.TableNumber, o.Amount, o.Status, o.PosSyncStatus, o.CreatedAt)
	if err != nil {
		t.Fatalf("seed payment_orders %q: %v", o.ID, err)
	}
}

type seedOrder = struct {
	ID            string
	TableNumber   string
	MenuItemName  string
	CategoryName  string
	Amount        int64
	Status        string
	PosSyncStatus string
	CreatedAt     time.Time
}

func createPaymentOrdersForListing(t *testing.T, ctx context.Context) {
	t.Helper()
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)

	seed := []seedOrder{
		{ID: "order-1", TableNumber: "T-01", MenuItemName: "Beer", CategoryName: "Drinks", Amount: 8000, Status: "DONE", PosSyncStatus: "SUCCEEDED", CreatedAt: base},
		{ID: "order-2", TableNumber: "T-02", MenuItemName: "Cider", CategoryName: "Drinks", Amount: 5000, Status: "READY", PosSyncStatus: "PENDING", CreatedAt: base.Add(1 * time.Hour)},
		{ID: "order-3", TableNumber: "T-03", MenuItemName: "Snack Plate", CategoryName: "Food", Amount: 15000, Status: "DONE", PosSyncStatus: "FAILED", CreatedAt: base.Add(2 * time.Hour)},
		{ID: "order-4", TableNumber: "T-04", MenuItemName: "Wine", CategoryName: "Drinks", Amount: 30000, Status: "DONE", PosSyncStatus: "NOT_CONFIGURED", CreatedAt: base.Add(24 * time.Hour)},
		{ID: "order-5", TableNumber: "T-05", MenuItemName: "Snack Plate", CategoryName: "Food", Amount: 15000, Status: "READY", PosSyncStatus: "PENDING", CreatedAt: base.Add(48 * time.Hour)},
	}
	for _, s := range seed {
		seedPaymentOrder(t, ctx, s)
	}
}

func TestRepository_ListPaymentOrdersPage_FiltersByStatus(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createPaymentOrdersForListing(t, ctx)

	items, total, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{
		Status: "DONE", Sort: "createdAt", Order: "asc", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage() error = %v", err)
	}
	if total != 3 {
		t.Fatalf("total = %d, want 3", total)
	}
	for _, item := range items {
		if item.Status != "DONE" {
			t.Errorf("unexpected non-DONE item leaked into status=DONE result: %+v", item)
		}
	}
}

func TestRepository_ListPaymentOrdersPage_FiltersByPosSyncStatus(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createPaymentOrdersForListing(t, ctx)

	items, total, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{
		PosSyncStatus: "FAILED", Sort: "createdAt", Order: "asc", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(items) != 1 || items[0].OrderID != "order-3" {
		t.Fatalf("items = %+v, want a single order-3 match", items)
	}
}

func TestRepository_ListPaymentOrdersPage_FiltersByDateRange(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createPaymentOrdersForListing(t, ctx)

	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	from := base
	to := base.Add(3 * time.Hour) // excludes order-4/order-5, includes order-1..3

	items, total, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{
		From: &from, To: &to, Sort: "createdAt", Order: "asc", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage() error = %v", err)
	}
	if total != 3 {
		t.Fatalf("total = %d, want 3", total)
	}
	for _, item := range items {
		if item.OrderID == "order-4" || item.OrderID == "order-5" {
			t.Errorf("item outside [from, to) leaked into result: %+v", item)
		}
	}
}

func TestRepository_ListPaymentOrdersPage_ToIsExclusive(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createPaymentOrdersForListing(t, ctx)

	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	exactlyAtOrder4 := base.Add(24 * time.Hour)

	items, total, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{
		To: &exactlyAtOrder4, Sort: "createdAt", Order: "asc", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage() error = %v", err)
	}
	if total != 3 {
		t.Fatalf("total = %d, want 3 (order-4 sits exactly at the exclusive `to` boundary)", total)
	}
	for _, item := range items {
		if item.OrderID == "order-4" {
			t.Errorf("order-4 at exactly `to` should be excluded (to is exclusive): %+v", item)
		}
	}
}

func TestRepository_ListPaymentOrdersPage_SearchMatchesTableNumberAndMenuItemName(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createPaymentOrdersForListing(t, ctx)

	t.Run("matches table number", func(t *testing.T) {
		items, total, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{
			Search: "T-03", Sort: "createdAt", Order: "asc", Page: 1, PageSize: 20,
		})
		if err != nil {
			t.Fatalf("ListPaymentOrdersPage() error = %v", err)
		}
		if total != 1 || len(items) != 1 || items[0].OrderID != "order-3" {
			t.Fatalf("items = %+v (total=%d), want a single order-3 match", items, total)
		}
	})

	t.Run("matches menu item name", func(t *testing.T) {
		items, total, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{
			Search: "Snack", Sort: "createdAt", Order: "asc", Page: 1, PageSize: 20,
		})
		if err != nil {
			t.Fatalf("ListPaymentOrdersPage() error = %v", err)
		}
		if total != 2 {
			t.Fatalf("total = %d, want 2", total)
		}
		for _, item := range items {
			if item.MenuItemName != "Snack Plate" {
				t.Errorf("unexpected non-matching item: %+v", item)
			}
		}
	})
}

func TestRepository_ListPaymentOrdersPage_SortsByAmount(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createPaymentOrdersForListing(t, ctx)

	items, total, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{
		Sort: "amount", Order: "asc", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage() error = %v", err)
	}
	if total != 5 {
		t.Fatalf("total = %d, want 5", total)
	}
	if len(items) != 5 || items[0].OrderID != "order-2" || items[4].OrderID != "order-4" {
		t.Fatalf("items = %+v, want ascending amount order starting with order-2 (5000) and ending with order-4 (30000)", items)
	}
}

func TestRepository_ListPaymentOrdersPage_PagesAndCounts(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createPaymentOrdersForListing(t, ctx)

	page1, total, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{
		Sort: "createdAt", Order: "asc", Page: 1, PageSize: 2,
	})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage() page 1 error = %v", err)
	}
	if total != 5 {
		t.Fatalf("total = %d, want 5", total)
	}
	if len(page1) != 2 || page1[0].OrderID != "order-1" || page1[1].OrderID != "order-2" {
		t.Fatalf("page1 = %+v, want [order-1, order-2]", page1)
	}

	page2, _, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{
		Sort: "createdAt", Order: "asc", Page: 2, PageSize: 2,
	})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage() page 2 error = %v", err)
	}
	if len(page2) != 2 || page2[0].OrderID != "order-3" || page2[1].OrderID != "order-4" {
		t.Fatalf("page2 = %+v, want [order-3, order-4]", page2)
	}
}

func TestRepository_ListPaymentOrdersPage_RejectsInvalidSort(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if _, _, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{Sort: "bogus", Order: "asc"}); err == nil {
		t.Fatal("ListPaymentOrdersPage() error = nil, want error for invalid sort")
	}
}
