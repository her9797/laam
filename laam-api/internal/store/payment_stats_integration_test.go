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
	BillID        string // "" = no bill (a legacy row)
}

// seedDonePaymentOrder inserts a DONE payment_orders row directly via SQL —
// seeding it directly (like
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
			payment_method, approved_at, pos_sync_status, created_at, bill_id
		) VALUES ($1, $2, $3, $4, $5, 'DONE', $6, $7, 'SUCCEEDED', $7, NULLIF($8, ''))
	`, o.ID, menuItemName, o.CategoryName, o.TableNumber, o.Amount, o.PaymentMethod, o.ApprovedAt, o.BillID)
	if err != nil {
		t.Fatalf("seed DONE payment_orders %q: %v", o.ID, err)
	}
}

// seedStatsBill inserts a PAID pos_bills row. synced marks its payment list
// as fully fetched from TossPlace (payments_synced_at set), which is what
// makes GetPaymentOrderStats trust its pos_payments over its menu rows.
func seedStatsBill(t *testing.T, ctx context.Context, id string, tableNumber string, openedAt time.Time, synced bool) {
	t.Helper()
	var syncedAt any
	if synced {
		syncedAt = openedAt
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO pos_bills (id, pos_order_id, table_number, status, opened_at, completed_at, payments_synced_at)
		VALUES ($1, 'pos-' || $1, $2, 'PAID', $3, $3, $4)
	`, id, tableNumber, openedAt, syncedAt); err != nil {
		t.Fatalf("seed pos_bills %q: %v", id, err)
	}
}

func seedStatsPayment(t *testing.T, ctx context.Context, id string, billID string, state string, sourceType string, amount int64, approvedAt time.Time) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO pos_payments (id, bill_id, state, source_type, payment_method, amount, approved_at)
		VALUES ($1, $2, $3, $4, $4, $5, $6)
	`, id, billID, state, sourceType, amount, approvedAt); err != nil {
		t.Fatalf("seed pos_payments %q: %v", id, err)
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

// seedMixedRevenueFixture builds one of each revenue source
// GetPaymentOrderStats has to reconcile, all within January 2026 KST:
//
//   - bill-a (synced): Beer 10,000 + Pizza 20,000 on the menu, paid as a
//     CARD 18,000 + CASH 10,000 split after a 2,000 POS discount, plus an
//     earlier CARD 18,000 attempt that was CANCELLED.
//   - bill-b (not synced yet): one 12,000 menu row completed as 'POS'. A
//     single payment event already recorded an APPROVED CARD 12,000, but
//     the bill's payment list has not been fully fetched, so the menu row
//     is the revenue source and the payment row must not add to it.
//   - legacy: an 8,000 '카드' row from before bills existed (no bill_id).
func seedMixedRevenueFixture(t *testing.T, ctx context.Context) {
	t.Helper()
	day10 := time.Date(2026, 1, 10, 21, 0, 0, 0, kst)
	seedStatsBill(t, ctx, "bill-a", "1", day10.Add(-time.Hour), true)
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "a1", TableNumber: "1", CategoryName: "Drinks", MenuItemName: "Beer",
		PaymentMethod: "POS", Amount: 10000, ApprovedAt: day10, BillID: "bill-a",
	})
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "a2", TableNumber: "1", CategoryName: "Food", MenuItemName: "Pizza",
		PaymentMethod: "POS", Amount: 20000, ApprovedAt: day10, BillID: "bill-a",
	})
	seedStatsPayment(t, ctx, "pay-a-cancelled", "bill-a", "CANCELLED", "CARD", 18000, day10.Add(-20*time.Minute))
	seedStatsPayment(t, ctx, "pay-a-card", "bill-a", "APPROVED", "CARD", 18000, day10.Add(-10*time.Minute))
	seedStatsPayment(t, ctx, "pay-a-cash", "bill-a", "APPROVED", "CASH", 10000, day10.Add(-5*time.Minute))

	day11 := time.Date(2026, 1, 11, 22, 0, 0, 0, kst)
	seedStatsBill(t, ctx, "bill-b", "2", day11.Add(-time.Hour), false)
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "b1", TableNumber: "2", CategoryName: "Drinks", MenuItemName: "Beer",
		PaymentMethod: "POS", Amount: 12000, ApprovedAt: day11, BillID: "bill-b",
	})
	seedStatsPayment(t, ctx, "pay-b-card", "bill-b", "APPROVED", "CARD", 12000, day11.Add(-5*time.Minute))

	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "legacy", TableNumber: "3", CategoryName: "Drinks", MenuItemName: "Highball",
		PaymentMethod: "카드", Amount: 8000, ApprovedAt: time.Date(2026, 1, 12, 20, 0, 0, 0, kst),
	})
}

func TestRepository_GetPaymentOrderStats_RevenueFollowsSyncedBillPayments(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	seedMixedRevenueFixture(t, ctx)

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	// 28,000 approved on bill-a + 12,000 fallback for bill-b + 8,000 legacy.
	if stats.Summary.TotalRevenue != 48000 {
		t.Errorf("TotalRevenue = %d, want 48000 (synced bill counted by its approved payments)", stats.Summary.TotalRevenue)
	}
	if stats.Summary.OrderCount != 4 {
		t.Errorf("OrderCount = %d, want 4 DONE menu rows", stats.Summary.OrderCount)
	}
	if stats.Summary.AverageOrderValue != 12000 {
		t.Errorf("AverageOrderValue = %d, want 12000 (revenue / menu rows)", stats.Summary.AverageOrderValue)
	}

	wantMethods := []struct {
		method  string
		revenue int64
		count   int
	}{
		{"CARD", 18000, 1},
		{"POS", 12000, 1},
		{"CASH", 10000, 1},
		{"카드", 8000, 1},
	}
	if len(stats.ByPaymentMethod) != len(wantMethods) {
		t.Fatalf("ByPaymentMethod = %+v, want %d entries", stats.ByPaymentMethod, len(wantMethods))
	}
	for i, want := range wantMethods {
		got := stats.ByPaymentMethod[i]
		if got.PaymentMethod != want.method || got.Revenue != want.revenue || got.OrderCount != want.count {
			t.Errorf("ByPaymentMethod[%d] = %+v, want %s/%d/%d", i, got, want.method, want.revenue, want.count)
		}
	}

	wantBuckets := []struct {
		bucket  string
		revenue int64
		count   int
	}{
		{"2026-01-10", 28000, 2},
		{"2026-01-11", 12000, 1},
		{"2026-01-12", 8000, 1},
	}
	if len(stats.Trend.Buckets) != len(wantBuckets) {
		t.Fatalf("Trend.Buckets = %+v, want %d buckets", stats.Trend.Buckets, len(wantBuckets))
	}
	for i, want := range wantBuckets {
		got := stats.Trend.Buckets[i]
		if got.Bucket != want.bucket || got.Revenue != want.revenue || got.OrderCount != want.count {
			t.Errorf("Trend.Buckets[%d] = %+v, want %s/%d/%d", i, got, want.bucket, want.revenue, want.count)
		}
	}

	// byCategory stays on the menu-price basis: the POS discount on bill-a
	// does not reach it.
	if len(stats.ByCategory) != 2 ||
		stats.ByCategory[0].CategoryName != "Drinks" || stats.ByCategory[0].Revenue != 30000 || stats.ByCategory[0].OrderCount != 3 ||
		stats.ByCategory[1].CategoryName != "Food" || stats.ByCategory[1].Revenue != 20000 || stats.ByCategory[1].OrderCount != 1 {
		t.Errorf("ByCategory = %+v, want Drinks/30000/3, Food/20000/1", stats.ByCategory)
	}
}

func TestRepository_GetPaymentOrderStats_BucketsPaymentsByTheirApprovedAt(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	// The payment is approved at 23:50 KST on the 10th, but the bill's menu
	// row is only marked DONE (order.completed) at 00:10 on the 11th.
	// Revenue follows the payment, the order count follows the menu row.
	paidAt := time.Date(2026, 1, 10, 23, 50, 0, 0, kst)
	seedStatsBill(t, ctx, "bill-late", "1", paidAt.Add(-time.Hour), true)
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "late-1", TableNumber: "1", CategoryName: "Drinks", PaymentMethod: "POS",
		Amount: 9000, ApprovedAt: time.Date(2026, 1, 11, 0, 10, 0, 0, kst), BillID: "bill-late",
	})
	seedStatsPayment(t, ctx, "pay-late", "bill-late", "APPROVED", "CARD", 9000, paidAt)

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	if len(stats.Trend.Buckets) != 2 {
		t.Fatalf("Trend.Buckets = %+v, want 2 buckets", stats.Trend.Buckets)
	}
	if got := stats.Trend.Buckets[0]; got.Bucket != "2026-01-10" || got.Revenue != 9000 || got.OrderCount != 0 {
		t.Errorf("Trend.Buckets[0] = %+v, want 2026-01-10/9000/0", got)
	}
	if got := stats.Trend.Buckets[1]; got.Bucket != "2026-01-11" || got.Revenue != 0 || got.OrderCount != 1 {
		t.Errorf("Trend.Buckets[1] = %+v, want 2026-01-11/0/1", got)
	}
}

func TestRepository_GetPaymentOrderStats_BusinessDayBasisAppliesToPayments(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	// Both the payment and the completion fall at 02:00-02:05 KST on the
	// 11th, i.e. inside the business day that opened on the 10th.
	paidAt := time.Date(2026, 1, 11, 2, 0, 0, 0, kst)
	seedStatsBill(t, ctx, "bill-night", "1", paidAt.Add(-time.Hour), true)
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "night-1", TableNumber: "1", CategoryName: "Drinks", PaymentMethod: "POS",
		Amount: 9000, ApprovedAt: paidAt.Add(5 * time.Minute), BillID: "bill-night",
	})
	seedStatsPayment(t, ctx, "pay-night", "bill-night", "APPROVED", "CASH", 7000, paidAt)

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, true)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	if len(stats.Trend.Buckets) != 1 {
		t.Fatalf("Trend.Buckets = %+v, want a single bucket", stats.Trend.Buckets)
	}
	if got := stats.Trend.Buckets[0]; got.Bucket != "2026-01-10" || got.Revenue != 7000 || got.OrderCount != 1 {
		t.Errorf("Trend.Buckets[0] = %+v, want 2026-01-10/7000/1", got)
	}
}
