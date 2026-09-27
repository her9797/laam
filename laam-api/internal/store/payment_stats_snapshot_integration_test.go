package store

import (
	"context"
	"strings"
	"testing"
	"time"
)

// TestEnsureSchema_CreatesPartialApprovedAtIndexForDoneOrders guards the
// index GetPaymentOrderStats relies on: every stats query filters
// `status = 'DONE' AND approved_at` range, so without a partial index on
// approved_at each of them sequentially scans payment_orders.
func TestEnsureSchema_CreatesPartialApprovedAtIndexForDoneOrders(t *testing.T) {
	resetDB(t)
	ctx := context.Background()

	var indexDef string
	err := testPool.QueryRow(ctx, `
		SELECT indexdef FROM pg_indexes
		WHERE tablename = 'payment_orders' AND indexname = 'idx_payment_orders_done_approved_at'
	`).Scan(&indexDef)
	if err != nil {
		t.Fatalf("idx_payment_orders_done_approved_at not found: %v", err)
	}
	if !strings.Contains(indexDef, "(approved_at)") || !strings.Contains(indexDef, "WHERE (status = 'DONE'::text)") {
		t.Errorf("indexdef = %q, want partial index on approved_at WHERE status = 'DONE'", indexDef)
	}
}

// TestGetPaymentOrderStats_FilterCanUseDoneApprovedAtIndex checks that the
// stats filter predicate actually matches the partial index (a mismatched
// predicate would silently leave the index unused). Sequential scans are
// disabled only for this session so the tiny test table does not make the
// planner prefer a seq scan for cost reasons alone.
func TestGetPaymentOrderStats_FilterCanUseDoneApprovedAtIndex(t *testing.T) {
	resetDB(t)
	ctx := context.Background()

	conn, err := testPool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SET enable_seqscan = off`); err != nil {
		t.Fatalf("disable seqscan: %v", err)
	}
	defer func() { _, _ = conn.Exec(ctx, `RESET enable_seqscan`) }()

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	rows, err := conn.Query(ctx, "EXPLAIN SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM payment_orders"+paymentOrderStatsFilterWhere, from, to)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			rows.Close()
			t.Fatalf("scan plan: %v", err)
		}
		plan.WriteString(line)
		plan.WriteString("\n")
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("explain rows: %v", err)
	}

	if !strings.Contains(plan.String(), "idx_payment_orders_done_approved_at") {
		t.Errorf("stats filter plan does not use idx_payment_orders_done_approved_at:\n%s", plan.String())
	}
}

// TestGetPaymentOrderStats_AllSectionsShareOneSnapshot commits new DONE
// orders and bill payments from another connection after the summary query
// has run. Every breakdown must still add up to the summary, i.e. all six
// queries must see the same snapshot.
func TestGetPaymentOrderStats_AllSectionsShareOneSnapshot(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "s1", TableNumber: "1", CategoryName: "Drinks", PaymentMethod: "카드",
		Amount: 8000, ApprovedAt: time.Date(2026, 1, 10, 20, 0, 0, 0, kst),
	})
	billPaidAt := time.Date(2026, 1, 10, 21, 0, 0, 0, kst)
	seedStatsBill(t, ctx, "snap-a", "3", billPaidAt.Add(-time.Hour), true)
	seedDonePaymentOrder(t, ctx, seedDoneOrder{
		ID: "s-bill", TableNumber: "3", CategoryName: "Food", PaymentMethod: "POS",
		Amount: 6000, ApprovedAt: billPaidAt, BillID: "snap-a",
	})
	seedStatsPayment(t, ctx, "snap-pay-a", "snap-a", "APPROVED", "CARD", 6000, billPaidAt)

	paymentOrderStatsAfterSummaryHook = func() {
		seedDonePaymentOrder(t, ctx, seedDoneOrder{
			ID: "s2", TableNumber: "2", CategoryName: "Food", PaymentMethod: "카드",
			Amount: 5000, ApprovedAt: time.Date(2026, 1, 11, 20, 0, 0, 0, kst),
		})
		seedStatsPayment(t, ctx, "snap-pay-late", "snap-a", "APPROVED", "CASH", 3000, billPaidAt.Add(time.Minute))
	}
	t.Cleanup(func() { paymentOrderStatsAfterSummaryHook = nil })

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, kst)
	to := time.Date(2026, 2, 1, 0, 0, 0, 0, kst)
	stats, err := repo.GetPaymentOrderStats(ctx, from, to, false)
	if err != nil {
		t.Fatalf("GetPaymentOrderStats() error = %v", err)
	}

	if stats.Summary.TotalRevenue != 14000 || stats.Summary.OrderCount != 2 {
		t.Fatalf("Summary = %+v, want revenue=14000 orderCount=2", stats.Summary)
	}
	sum := func(name string, revenue int64, count int) {
		t.Helper()
		if revenue != stats.Summary.TotalRevenue || count != stats.Summary.OrderCount {
			t.Errorf("%s totals = revenue %d count %d, want summary revenue %d count %d",
				name, revenue, count, stats.Summary.TotalRevenue, stats.Summary.OrderCount)
		}
	}
	// byPaymentMethod counts payments, not menu rows, so only its revenue
	// has to match the summary.
	sumRevenue := func(name string, revenue int64) {
		t.Helper()
		if revenue != stats.Summary.TotalRevenue {
			t.Errorf("%s revenue = %d, want summary revenue %d", name, revenue, stats.Summary.TotalRevenue)
		}
	}
	var revenue int64
	var count int
	for _, b := range stats.Trend.Buckets {
		revenue, count = revenue+b.Revenue, count+b.OrderCount
	}
	sum("Trend", revenue, count)
	revenue, count = 0, 0
	for _, row := range stats.ByCategory {
		revenue, count = revenue+row.Revenue, count+row.OrderCount
	}
	sum("ByCategory", revenue, count)
	revenue = 0
	for _, row := range stats.ByPaymentMethod {
		revenue += row.Revenue
	}
	sumRevenue("ByPaymentMethod", revenue)
	revenue, count = 0, 0
	for _, row := range stats.ByTable {
		revenue, count = revenue+row.Revenue, count+row.OrderCount
	}
	sum("ByTable", revenue, count)
	revenue, count = 0, 0
	for _, row := range stats.ByMenuItem {
		revenue, count = revenue+row.Revenue, count+row.OrderCount
	}
	sum("ByMenuItem", revenue, count)
}
