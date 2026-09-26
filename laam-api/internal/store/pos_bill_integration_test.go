package store

import (
	"context"
	"testing"
	"time"
)

func seedBillOrder(t *testing.T, ctx context.Context, id string, posOrderID string, tableNumber string, amount int64, status string, createdAt time.Time) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, pos_order_id, created_at
		) VALUES ($1, '하우스 하이볼', '하이볼', $2, $3, $4, 'SUCCEEDED', NULLIF($5, ''), $6)
	`, id, tableNumber, amount, status, posOrderID, createdAt); err != nil {
		t.Fatalf("seed payment_orders %q: %v", id, err)
	}
}

func queryBill(t *testing.T, ctx context.Context, posOrderID string) (id string, status string, tableNumber string, openedAt time.Time) {
	t.Helper()
	if err := testPool.QueryRow(ctx, `
		SELECT id, status, table_number, opened_at FROM pos_bills WHERE pos_order_id = $1
	`, posOrderID).Scan(&id, &status, &tableNumber, &openedAt); err != nil {
		t.Fatalf("query pos_bills %q: %v", posOrderID, err)
	}
	return id, status, tableNumber, openedAt
}

func orderStatusAndBill(t *testing.T, ctx context.Context, orderID string) (string, string) {
	t.Helper()
	var status, billID string
	if err := testPool.QueryRow(ctx, `
		SELECT status, COALESCE(bill_id, '') FROM payment_orders WHERE id = $1
	`, orderID).Scan(&status, &billID); err != nil {
		t.Fatalf("query payment_orders %q: %v", orderID, err)
	}
	return status, billID
}

func TestRepository_EnsurePOSBill_GroupsOrdersSharingAPOSOrderIntoOneOpenBill(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seedBillOrder(t, ctx, "order-a", "pos-1", "T-03", 11000, "READY", base)
	seedBillOrder(t, ctx, "order-b", "pos-1", "T-03", 9000, "READY", base.Add(10*time.Minute))

	first, err := testRepo.EnsurePOSBill(ctx, "pos-1")
	if err != nil {
		t.Fatalf("EnsurePOSBill() error = %v", err)
	}
	second, err := testRepo.EnsurePOSBill(ctx, "pos-1")
	if err != nil {
		t.Fatalf("EnsurePOSBill() second error = %v", err)
	}
	if first == "" || first != second {
		t.Fatalf("bill ids = %q/%q, want one stable id", first, second)
	}

	id, status, table, openedAt := queryBill(t, ctx, "pos-1")
	if id != first || status != "OPEN" || table != "T-03" || !openedAt.Equal(base) {
		t.Fatalf("bill = %s/%s/%s/%s, want %s/OPEN/T-03/%s", id, status, table, openedAt, first, base)
	}
	for _, orderID := range []string{"order-a", "order-b"} {
		if _, billID := orderStatusAndBill(t, ctx, orderID); billID != first {
			t.Fatalf("%s bill_id = %q, want %q", orderID, billID, first)
		}
	}
}

func TestRepository_CompletePOSPluginOrder_LinksOrderToOpenBill(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedBillOrder(t, ctx, "order-plugin", "", "T-01", 11000, "READY", time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC))
	if _, err := testPool.Exec(ctx, `
		UPDATE payment_orders SET pos_sync_status = 'PENDING', pos_claim_token = 'claim-1' WHERE id = 'order-plugin'
	`); err != nil {
		t.Fatalf("prepare claim: %v", err)
	}

	if err := testRepo.CompletePOSPluginOrder(ctx, "order-plugin", "claim-1", "pos-plugin-1"); err != nil {
		t.Fatalf("CompletePOSPluginOrder() error = %v", err)
	}

	billID, status, _, _ := queryBill(t, ctx, "pos-plugin-1")
	if status != "OPEN" {
		t.Fatalf("bill status = %q, want OPEN", status)
	}
	if _, linked := orderStatusAndBill(t, ctx, "order-plugin"); linked != billID {
		t.Fatalf("order bill_id = %q, want %q", linked, billID)
	}
}

func TestRepository_UpdatePaymentOrderPOSSync_SucceededLinksOrderToOpenBill(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedBillOrder(t, ctx, "order-openapi", "", "T-02", 11000, "READY", time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC))

	if err := testRepo.UpdatePaymentOrderPOSSync(ctx, "order-openapi", "SUCCEEDED", "pos-openapi-1", ""); err != nil {
		t.Fatalf("UpdatePaymentOrderPOSSync() error = %v", err)
	}

	billID, status, table, _ := queryBill(t, ctx, "pos-openapi-1")
	if status != "OPEN" || table != "T-02" {
		t.Fatalf("bill = %s/%s, want OPEN/T-02", status, table)
	}
	if _, linked := orderStatusAndBill(t, ctx, "order-openapi"); linked != billID {
		t.Fatalf("order bill_id = %q, want %q", linked, billID)
	}
}

func TestRepository_CompletePOSBill_MarksEveryOrderOnTheSamePOSOrderDone(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seedBillOrder(t, ctx, "order-1", "pos-1", "T-03", 11000, "READY", base)
	seedBillOrder(t, ctx, "order-2", "pos-1", "T-03", 9000, "ACKNOWLEDGED", base.Add(time.Minute))
	seedBillOrder(t, ctx, "order-3", "pos-1", "T-03", 5000, "CANCELLED", base.Add(2*time.Minute))
	seedBillOrder(t, ctx, "order-other", "pos-2", "T-04", 7000, "READY", base)

	completedAt := base.Add(time.Hour)
	billID, found, err := testRepo.CompletePOSBill(ctx, CompletePOSBillInput{POSOrderID: "pos-1", OrderKey: "order-1", CompletedAt: completedAt})
	if err != nil || !found {
		t.Fatalf("CompletePOSBill() = %q/%v/%v, want found", billID, found, err)
	}

	for id, want := range map[string]string{"order-1": "DONE", "order-2": "DONE", "order-3": "CANCELLED", "order-other": "READY"} {
		status, linked := orderStatusAndBill(t, ctx, id)
		if status != want {
			t.Fatalf("%s status = %q, want %q", id, status, want)
		}
		if id != "order-other" && linked != billID {
			t.Fatalf("%s bill_id = %q, want %q", id, linked, billID)
		}
	}
	_, status, _, _ := queryBill(t, ctx, "pos-1")
	if status != "PAID" {
		t.Fatalf("bill status = %q, want PAID", status)
	}

	// A retried webhook delivery is a no-op.
	again, found, err := testRepo.CompletePOSBill(ctx, CompletePOSBillInput{POSOrderID: "pos-1", OrderKey: "order-1", CompletedAt: completedAt})
	if err != nil || !found || again != billID {
		t.Fatalf("retry = %q/%v/%v, want %q", again, found, err, billID)
	}
}

func TestRepository_CompletePOSBill_AttachesLegacyOrderFoundOnlyByOrderKey(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedBillOrder(t, ctx, "order-legacy", "", "T-05", 11000, "READY", time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC))

	_, found, err := testRepo.CompletePOSBill(ctx, CompletePOSBillInput{POSOrderID: "pos-legacy", OrderKey: "order-legacy", CompletedAt: time.Now()})
	if err != nil || !found {
		t.Fatalf("CompletePOSBill() found=%v err=%v", found, err)
	}
	if status, _ := orderStatusAndBill(t, ctx, "order-legacy"); status != "DONE" {
		t.Fatalf("status = %q, want DONE", status)
	}
}

func TestRepository_CompletePOSBill_ReportsNotFoundForUnknownPOSOrder(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)

	_, found, err := testRepo.CompletePOSBill(ctx, CompletePOSBillInput{POSOrderID: "pos-unknown", OrderKey: "native-key", CompletedAt: time.Now()})
	if err != nil || found {
		t.Fatalf("CompletePOSBill() found=%v err=%v, want not found", found, err)
	}
}

func TestRepository_CancelPOSBill_CancelsEveryOrderOnThePOSOrder(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seedBillOrder(t, ctx, "order-1", "pos-1", "T-03", 11000, "DONE", base)
	seedBillOrder(t, ctx, "order-2", "pos-1", "T-03", 9000, "READY", base)

	found, err := testRepo.CancelPOSBill(ctx, "pos-1", "order-1", base.Add(time.Hour))
	if err != nil || !found {
		t.Fatalf("CancelPOSBill() found=%v err=%v", found, err)
	}
	for _, id := range []string{"order-1", "order-2"} {
		if status, _ := orderStatusAndBill(t, ctx, id); status != "CANCELLED" {
			t.Fatalf("%s status = %q, want CANCELLED", id, status)
		}
	}
	if _, status, _, _ := queryBill(t, ctx, "pos-1"); status != "CANCELLED" {
		t.Fatalf("bill status = %q, want CANCELLED", status)
	}
}

func TestRepository_UpsertPOSPayments_StoresSplitPaymentsAndUpdatesCancellation(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seedBillOrder(t, ctx, "order-1", "pos-1", "T-03", 50000, "DONE", base)

	payments := []POSPaymentInput{
		{ID: "pay-card", State: "APPROVED", SourceType: "CARD", PaymentMethod: "신용카드", CardBrand: "신한", Amount: 30000, ApprovedNo: "A1", ApprovedAt: base},
		{ID: "pay-cash", State: "APPROVED", SourceType: "CASH", PaymentMethod: "현금", Amount: 20000, ApprovedAt: base},
	}
	if err := testRepo.UpsertPOSPayments(ctx, "pos-1", payments, true); err != nil {
		t.Fatalf("UpsertPOSPayments() error = %v", err)
	}
	// Same payment arrives again as cancelled (payment webhook).
	cancelled := payments[1]
	cancelled.State = "CANCELLED"
	cancelled.CancelledAt = base.Add(time.Hour)
	if err := testRepo.UpsertPOSPayments(ctx, "pos-1", []POSPaymentInput{cancelled}, false); err != nil {
		t.Fatalf("UpsertPOSPayments(cancel) error = %v", err)
	}

	billID, _, _, _ := queryBill(t, ctx, "pos-1")
	rows, err := testPool.Query(ctx, `SELECT id, state, source_type, amount, bill_id FROM pos_payments ORDER BY id`)
	if err != nil {
		t.Fatalf("query pos_payments: %v", err)
	}
	defer rows.Close()
	got := map[string]string{}
	for rows.Next() {
		var id, state, source, linked string
		var amount int64
		if err := rows.Scan(&id, &state, &source, &amount, &linked); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if linked != billID {
			t.Fatalf("%s bill_id = %q, want %q", id, linked, billID)
		}
		got[id] = state + "/" + source
	}
	if len(got) != 2 || got["pay-card"] != "APPROVED/CARD" || got["pay-cash"] != "CANCELLED/CASH" {
		t.Fatalf("payments = %v", got)
	}

	var synced bool
	if err := testPool.QueryRow(ctx, `SELECT payments_synced_at IS NOT NULL FROM pos_bills WHERE id = $1`, billID).Scan(&synced); err != nil {
		t.Fatalf("query synced: %v", err)
	}
	if !synced {
		t.Fatal("payments_synced_at is NULL after a full sync")
	}
}

func TestRepository_ClaimPOSBillsNeedingPaymentSync(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seedBillOrder(t, ctx, "order-1", "pos-synced", "T-01", 10000, "READY", base)
	seedBillOrder(t, ctx, "order-2", "pos-missing", "T-02", 10000, "READY", base)
	seedBillOrder(t, ctx, "order-3", "pos-open", "T-03", 10000, "READY", base)
	for _, posOrderID := range []string{"pos-synced", "pos-missing"} {
		if _, _, err := testRepo.CompletePOSBill(ctx, CompletePOSBillInput{POSOrderID: posOrderID, CompletedAt: base}); err != nil {
			t.Fatalf("CompletePOSBill(%s) error = %v", posOrderID, err)
		}
	}
	if _, err := testRepo.EnsurePOSBill(ctx, "pos-open"); err != nil {
		t.Fatalf("EnsurePOSBill() error = %v", err)
	}
	if err := testRepo.UpsertPOSPayments(ctx, "pos-synced", nil, true); err != nil {
		t.Fatalf("UpsertPOSPayments() error = %v", err)
	}

	// Completing a bill counts as a sync attempt (the webhook fetches its
	// payments right away), so nothing is due yet.
	ids, err := testRepo.ClaimPOSBillsNeedingPaymentSync(ctx, 10)
	if err != nil {
		t.Fatalf("ClaimPOSBillsNeedingPaymentSync() error = %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("ids = %v, want none right after completion", ids)
	}

	if _, err := testPool.Exec(ctx, `UPDATE pos_bills SET payment_sync_attempted_at = NOW() - INTERVAL '1 hour'`); err != nil {
		t.Fatalf("age attempts: %v", err)
	}
	ids, err = testRepo.ClaimPOSBillsNeedingPaymentSync(ctx, 10)
	if err != nil {
		t.Fatalf("ClaimPOSBillsNeedingPaymentSync() error = %v", err)
	}
	if len(ids) != 1 || ids[0] != "pos-missing" {
		t.Fatalf("ids = %v, want [pos-missing]", ids)
	}

	// A claimed bill is not handed out again until its retry interval passes.
	ids, err = testRepo.ClaimPOSBillsNeedingPaymentSync(ctx, 10)
	if err != nil {
		t.Fatalf("ClaimPOSBillsNeedingPaymentSync() error = %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("ids = %v, want none while the claim is fresh", ids)
	}
}

func TestRepository_ListPOSOrderLines(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedBillOrder(t, ctx, "order-1", "pos-1", "T-01", 11000, "DONE", time.Now())
	seedBillOrder(t, ctx, "order-2", "pos-2", "T-01", 9000, "DONE", time.Now())

	lines, err := testRepo.ListPOSOrderLines(ctx, "pos-1")
	if err != nil {
		t.Fatalf("ListPOSOrderLines() error = %v", err)
	}
	if len(lines) != 1 || lines[0].MenuItemName != "하우스 하이볼" || lines[0].CategoryName != "하이볼" || lines[0].Amount != 11000 {
		t.Fatalf("lines = %+v", lines)
	}
}
