package store

import (
	"context"
	"testing"
	"time"
)

type seedDoneOrder = struct {
	ID            string
	TableNumber   string
	CategoryName  string
	MenuItemName  string // defaults to "Item" when blank
	PaymentMethod string
	Amount        int64
	ApprovedAt    time.Time
}

// seedDonePaymentOrder inserts a DONE payment_orders row directly via SQL —
// GetPaymentOrderStats only reads this table, so seeding it directly (like
// payment_list_query_integration_test.go's seedPaymentOrder) keeps these
// tests focused on the aggregation logic rather than the full
// create-order/confirm-payment flow, which requires a real menu item with a
// toss_catalog_item_id.
func seedDonePaymentOrder(t *testing.T, ctx context.Context, o seedDoneOrder) {
	t.Helper()
	menuItemName := o.MenuItemName
	if menuItemName == "" {
		menuItemName = "Item"
	}
	_, err := testPool.Exec(ctx, `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status,
			payment_method, approved_at, pos_sync_status, created_at
		) VALUES ($1, $2, $3, $4, $5, 'DONE', $6, $7, 'SUCCEEDED', $7)
	`, o.ID, menuItemName, o.CategoryName, o.TableNumber, o.Amount, o.PaymentMethod, o.ApprovedAt)
	if err != nil {
		t.Fatalf("seed DONE payment_orders %q: %v", o.ID, err)
	}
}

func seedReadyPaymentOrder(t *testing.T, ctx context.Context, id string, createdAt time.Time) {
	t.Helper()
	_, err := testPool.Exec(ctx, `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, created_at
		) VALUES ($1, 'Item', 'Drinks', 'T-01', 5000, 'READY', 'PENDING', $2)
	`, id, createdAt)
	if err != nil {
		t.Fatalf("seed READY payment_orders %q: %v", id, err)
	}
}

// kst is a fixed +09:00 offset, used to build test fixtures whose wall-clock
// KST date is unambiguous, independent of the test runner's own system
// timezone (GetPaymentOrderStats buckets by 'Asia/Seoul' regardless of where
// the Go test process itself runs).
var kst = time.FixedZone("KST", 9*60*60)

func TestRepository_GetPaymentOrderStats_SummaryTotalsOnlyDoneOrders(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "s1", TableNumber: "1", CategoryName: "Drinks", PaymentMethod: "카드",
		Amount: 8000, ApprovedAt: time.Date(2026, 1, 10, 20, 0, 0, 0, kst),
	})
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "s2", TableNumber: "2", CategoryName: "Food", PaymentMethod: "간편결제",
		Amount: 15000, ApprovedAt: time.Date(2026, 1, 11, 21, 0, 0, 0, kst),
	})
	seedReadyPaymentOrder(t, ctx, "s3", time.Date(2026, 1, 11, 22, 0, 0, 0, kst))

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	if stats.Summary.TotalRevenue != 23000 {
		t.Errorf("TotalRevenue = %d, want 23000 (READY order excluded)", stats.Summary.TotalRevenue)
	}
	if stats.Summary.OrderCount != 2 {
		t.Errorf("OrderCount = %d, want 2", stats.Summary.OrderCount)
	}
	if stats.Summary.AverageOrderValue != 11500 {
		t.Errorf("AverageOrderValue = %d, want 11500", stats.Summary.AverageOrderValue)
	}
}

func TestRepository_GetPaymentOrderStats_EmptyRangeHasZeroAverageNotDivideByZero(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	if stats.Summary.OrderCount != 0 || stats.Summary.TotalRevenue != 0 || stats.Summary.AverageOrderValue != 0 {
		t.Errorf("Summary = %+v, want all zero for an empty range", stats.Summary)
	}
	if len(stats.Trend.Buckets) != 0 || len(stats.ByCategory) != 0 || len(stats.ByPaymentMethod) != 0 || len(stats.ByTable) != 0 {
		t.Errorf("expected every breakdown to be empty, got %+v", stats)
	}
}

func TestRepository_GetPaymentOrderStats_TrendUnitByRangeLength(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 12, 0, 0, 0, kst)

	cases := []struct {
		name     string
		days     int
		wantUnit string
	}{
		{"31 days is still daily", 31, "day"},
		{"32 days rolls to weekly", 32, "week"},
		{"180 days is still weekly", 180, "week"},
		{"181 days rolls to monthly", 181, "month"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			to := base.AddDate(0, 0, tc.days)
			stats, err := repo.GetPaymentOrderStats(ctx, base, to, false)
			if err != nil {
				t.Fatalf("GetPaymentOrderStats() error = %v", err)
			}
			if stats.Trend.Unit != tc.wantUnit {
				t.Errorf("Trend.Unit = %q, want %q", stats.Trend.Unit, tc.wantUnit)
			}
		})
	}
}

func TestRepository_GetPaymentOrderStats_BucketsByKSTCalendarDate(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	// 2026-01-10T15:30:00Z is 2026-01-11T00:30:00+09:00 in KST — past
	// midnight, so it must bucket into the 11th, not the 10th. This is the
	// whole point of bucketing "AT TIME ZONE 'Asia/Seoul'" instead of on the
	// raw (UTC-stored) timestamptz.
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "b1", TableNumber: "1", CategoryName: "Drinks", PaymentMethod: "카드",
		Amount: 8000, ApprovedAt: time.Date(2026, 1, 10, 15, 30, 0, 0, time.UTC),
	})

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	if len(stats.Trend.Buckets) != 1 || stats.Trend.Buckets[0].Bucket != "2026-01-11" {
		t.Fatalf("Trend.Buckets = %+v, want a single 2026-01-11 bucket", stats.Trend.Buckets)
	}
	if stats.Trend.Buckets[0].Revenue != 8000 || stats.Trend.Buckets[0].OrderCount != 1 {
		t.Errorf("bucket = %+v, want revenue=8000 orderCount=1", stats.Trend.Buckets[0])
	}
}

func TestRepository_GetPaymentOrderStats_GroupsByCategoryPaymentMethodAndTable(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "g1", TableNumber: "1", CategoryName: "Drinks", PaymentMethod: "카드",
		Amount: 8000, ApprovedAt: time.Date(2026, 1, 10, 20, 0, 0, 0, kst),
	})
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "g2", TableNumber: "1", CategoryName: "Drinks", PaymentMethod: "카드",
		Amount: 5000, ApprovedAt: time.Date(2026, 1, 10, 20, 30, 0, 0, kst),
	})
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "g3", TableNumber: "2", CategoryName: "Food", PaymentMethod: "간편결제",
		Amount: 15000, ApprovedAt: time.Date(2026, 1, 11, 21, 0, 0, 0, kst),
	})

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	if len(stats.ByCategory) != 2 {
		t.Fatalf("ByCategory = %+v, want 2 entries", stats.ByCategory)
	}
	// Ordered by revenue descending.
	if stats.ByCategory[0].CategoryName != "Food" || stats.ByCategory[0].Revenue != 15000 || stats.ByCategory[0].OrderCount != 1 {
		t.Errorf("ByCategory[0] = %+v, want Food/15000/1", stats.ByCategory[0])
	}
	if stats.ByCategory[1].CategoryName != "Drinks" || stats.ByCategory[1].Revenue != 13000 || stats.ByCategory[1].OrderCount != 2 {
		t.Errorf("ByCategory[1] = %+v, want Drinks/13000/2", stats.ByCategory[1])
	}

	if len(stats.ByPaymentMethod) != 2 {
		t.Fatalf("ByPaymentMethod = %+v, want 2 entries", stats.ByPaymentMethod)
	}
	if len(stats.ByTable) != 2 {
		t.Fatalf("ByTable = %+v, want 2 entries", stats.ByTable)
	}
	// Ordered by revenue descending: table 2 (a single 15,000 order) outranks
	// table 1 (two orders summing to 13,000).
	if stats.ByTable[0].TableNumber != "2" || stats.ByTable[0].Revenue != 15000 || stats.ByTable[0].OrderCount != 1 {
		t.Errorf("ByTable[0] = %+v, want 2/15000/1", stats.ByTable[0])
	}
	if stats.ByTable[1].TableNumber != "1" || stats.ByTable[1].Revenue != 13000 || stats.ByTable[1].OrderCount != 2 {
		t.Errorf("ByTable[1] = %+v, want 1/13000/2", stats.ByTable[1])
	}
}

func TestRepository_GetPaymentOrderStats_GroupsByMenuItem(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "m1", TableNumber: "1", CategoryName: "Drinks", MenuItemName: "Beer",
		PaymentMethod: "카드", Amount: 8000, ApprovedAt: time.Date(2026, 1, 10, 20, 0, 0, 0, kst),
	})
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "m2", TableNumber: "1", CategoryName: "Drinks", MenuItemName: "Beer",
		PaymentMethod: "카드", Amount: 8000, ApprovedAt: time.Date(2026, 1, 10, 20, 30, 0, 0, kst),
	})
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "m3", TableNumber: "2", CategoryName: "Food", MenuItemName: "Pizza",
		PaymentMethod: "간편결제", Amount: 15000, ApprovedAt: time.Date(2026, 1, 11, 21, 0, 0, 0, kst),
	})

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	if len(stats.ByMenuItem) != 2 {
		t.Fatalf("ByMenuItem = %+v, want 2 entries", stats.ByMenuItem)
	}
	// Ordered by revenue descending: Beer (two orders summing to 16,000)
	// outranks Pizza (a single 15,000 order).
	if stats.ByMenuItem[0].MenuItemName != "Beer" || stats.ByMenuItem[0].Revenue != 16000 || stats.ByMenuItem[0].OrderCount != 2 {
		t.Errorf("ByMenuItem[0] = %+v, want Beer/16000/2", stats.ByMenuItem[0])
	}
	if stats.ByMenuItem[1].MenuItemName != "Pizza" || stats.ByMenuItem[1].Revenue != 15000 || stats.ByMenuItem[1].OrderCount != 1 {
		t.Errorf("ByMenuItem[1] = %+v, want Pizza/15000/1", stats.ByMenuItem[1])
	}
}

func TestRepository_GetPaymentOrderStats_UnlabeledTableGroupsUnderBlank(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "u1", TableNumber: "", CategoryName: "Drinks", PaymentMethod: "카드",
		Amount: 8000, ApprovedAt: time.Date(2026, 1, 10, 20, 0, 0, 0, kst),
	})

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	if len(stats.ByTable) != 1 || stats.ByTable[0].TableNumber != "" {
		t.Fatalf("ByTable = %+v, want a single blank-table entry", stats.ByTable)
	}
}

func TestRepository_GetPaymentOrderStats_BusinessDayBasisShiftsBucketBoundary(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	// 2026-01-11T02:00 KST falls after midnight but before the 06:00 close
	// buffer, so it belongs to the business day that opened the evening of
	// the 10th — the whole point of the business-day basis existing
	// alongside the plain KST-calendar basis TestRepository_
	// GetPaymentOrderStats_BucketsByKSTCalendarDate already covers.
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "bd1", TableNumber: "1", CategoryName: "Drinks", PaymentMethod: "카드",
		Amount: 8000, ApprovedAt: time.Date(2026, 1, 11, 2, 0, 0, 0, kst),
	})

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)

	t.Run("calendar basis buckets it on the 11th", func(t *testing.T) {
		stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
		if err != nil {
			t.Fatalf("GetPaymentOrderStats() error = %v", err)
		}
		if len(stats.Trend.Buckets) != 1 || stats.Trend.Buckets[0].Bucket != "2026-01-11" {
			t.Fatalf("Trend.Buckets = %+v, want a single 2026-01-11 bucket", stats.Trend.Buckets)
		}
	})

	t.Run("business-day basis buckets it on the 10th", func(t *testing.T) {
		stats, err := repo.GetPaymentOrderStats(ctx, from, to, true)
		if err != nil {
			t.Fatalf("GetPaymentOrderStats() error = %v", err)
		}
		if len(stats.Trend.Buckets) != 1 || stats.Trend.Buckets[0].Bucket != "2026-01-10" {
			t.Fatalf("Trend.Buckets = %+v, want a single 2026-01-10 bucket", stats.Trend.Buckets)
		}
	})
}
