package store

import (
	"context"
	"testing"
	"time"
)

func paymentStateAndCancelledAt(t *testing.T, ctx context.Context, paymentID string) (string, *time.Time) {
	t.Helper()
	var state string
	var cancelledAt *time.Time
	if err := testPool.QueryRow(ctx, `SELECT state, cancelled_at FROM pos_payments WHERE id = $1`, paymentID).Scan(&state, &cancelledAt); err != nil {
		t.Fatalf("query pos_payments %q: %v", paymentID, err)
	}
	return state, cancelledAt
}

// A webhook retry or a payment list fetched before the cancellation
// committed can deliver the old APPROVED state after CANCELLED; a
// cancelled payment must stay cancelled.
func TestRepository_UpsertPOSPayments_LateApprovedDoesNotRevertCancellation(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seedBillOrder(t, ctx, "order-1", "pos-1", "T-03", 20000, "DONE", base)

	approved := POSPaymentInput{ID: "pay-1", State: "APPROVED", SourceType: "CARD", Amount: 20000, ApprovedAt: base}
	cancelled := approved
	cancelled.State = "CANCELLED"
	cancelled.CancelledAt = base.Add(time.Hour)
	for _, step := range [][]POSPaymentInput{{approved}, {cancelled}, {approved}} {
		if err := testRepo.UpsertPOSPayments(ctx, "pos-1", step, false); err != nil {
			t.Fatalf("UpsertPOSPayments() error = %v", err)
		}
	}
	if err := testRepo.UpsertPOSPayments(ctx, "pos-1", []POSPaymentInput{approved}, true); err != nil {
		t.Fatalf("UpsertPOSPayments(full) error = %v", err)
	}

	state, cancelledAt := paymentStateAndCancelledAt(t, ctx, "pay-1")
	if state != "CANCELLED" || cancelledAt == nil || !cancelledAt.Equal(base.Add(time.Hour)) {
		t.Fatalf("pay-1 = %s cancelled_at %v, want CANCELLED at %v", state, cancelledAt, base.Add(time.Hour))
	}
}

// Cancelling a paid bill whose recorded payments are still APPROVED must
// leave it claimable for a payment re-sync, so a failed refresh right after
// the cancellation is retried.
func TestRepository_ClaimPOSBillsNeedingPaymentSync_ClaimsCancelledBillsWithApprovedPayments(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seedBillOrder(t, ctx, "order-1", "pos-refund", "T-01", 10000, "READY", base)
	seedBillOrder(t, ctx, "order-2", "pos-void", "T-02", 10000, "READY", base)
	for _, posOrderID := range []string{"pos-refund", "pos-void"} {
		if _, _, err := testRepo.CompletePOSBill(ctx, CompletePOSBillInput{POSOrderID: posOrderID, CompletedAt: base}); err != nil {
			t.Fatalf("CompletePOSBill(%s) error = %v", posOrderID, err)
		}
	}
	if err := testRepo.UpsertPOSPayments(ctx, "pos-refund", []POSPaymentInput{
		{ID: "pay-refund", State: "APPROVED", SourceType: "CARD", Amount: 10000, ApprovedAt: base},
	}, true); err != nil {
		t.Fatalf("UpsertPOSPayments() error = %v", err)
	}
	if err := testRepo.UpsertPOSPayments(ctx, "pos-void", []POSPaymentInput{
		{ID: "pay-void", State: "CANCELLED", SourceType: "CARD", Amount: 10000, ApprovedAt: base, CancelledAt: base},
	}, true); err != nil {
		t.Fatalf("UpsertPOSPayments() error = %v", err)
	}
	for _, posOrderID := range []string{"pos-refund", "pos-void"} {
		if _, err := testRepo.CancelPOSBill(ctx, posOrderID, "", base.Add(time.Hour)); err != nil {
			t.Fatalf("CancelPOSBill(%s) error = %v", posOrderID, err)
		}
	}
	if _, err := testPool.Exec(ctx, `UPDATE pos_bills SET payment_sync_attempted_at = NOW() - INTERVAL '1 hour'`); err != nil {
		t.Fatalf("age attempts: %v", err)
	}

	ids, err := testRepo.ClaimPOSBillsNeedingPaymentSync(ctx, 10)
	if err != nil {
		t.Fatalf("ClaimPOSBillsNeedingPaymentSync() error = %v", err)
	}
	if len(ids) != 1 || ids[0] != "pos-refund" {
		t.Fatalf("ids = %v, want [pos-refund] (cancelled with an APPROVED payment recorded)", ids)
	}
}

// A bill created by payment events alone (no menu row yet) must still be
// cancelled by order.cancelled instead of staying OPEN forever.
func TestRepository_CancelPOSBill_CancelsBillWithoutMenuRows(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	if err := testRepo.UpsertPOSPayments(ctx, "pos-payonly", []POSPaymentInput{
		{ID: "pay-1", State: "APPROVED", SourceType: "CASH", Amount: 6000, ApprovedAt: base},
	}, false); err != nil {
		t.Fatalf("UpsertPOSPayments() error = %v", err)
	}

	found, err := testRepo.CancelPOSBill(ctx, "pos-payonly", "", base.Add(time.Hour))
	if err != nil || !found {
		t.Fatalf("CancelPOSBill() found=%v err=%v, want found", found, err)
	}
	if _, status, _, _ := queryBill(t, ctx, "pos-payonly"); status != "CANCELLED" {
		t.Fatalf("bill status = %q, want CANCELLED", status)
	}
}
