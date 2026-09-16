package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func seedPOSPaymentOrder(t *testing.T, ctx context.Context, id string, amount int64, status string) {
	t.Helper()
	seedPaymentOrder(t, ctx, seedOrder{
		ID:            id,
		TableNumber:   "T-01",
		MenuItemName:  "Beer",
		CategoryName:  "Drinks",
		Amount:        amount,
		Status:        status,
		PosSyncStatus: "SUCCEEDED",
		CreatedAt:     time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC),
	})
}

func TestRepository_CompletePaymentOrderFromPOS_MarksReadyOrderDone(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-pos-1", 11000, "READY")

	approvedAt := time.Date(2026, 1, 10, 13, 0, 0, 0, time.UTC)
	order, err := testRepo.CompletePaymentOrderFromPOS(ctx, "order-pos-1", approvedAt, 1000, 10000, 0)
	if err != nil {
		t.Fatalf("CompletePaymentOrderFromPOS() error = %v", err)
	}
	if order.Status != "DONE" {
		t.Fatalf("Status = %q, want DONE", order.Status)
	}
	if order.PaymentMethod != "POS" {
		t.Fatalf("PaymentMethod = %q, want POS", order.PaymentMethod)
	}
	if order.VAT != 1000 || order.SuppliedAmount != 10000 || order.TaxFreeAmount != 0 {
		t.Fatalf("amounts = vat:%d supplied:%d taxFree:%d, want 1000/10000/0", order.VAT, order.SuppliedAmount, order.TaxFreeAmount)
	}
	if order.ApprovedAt == "" {
		t.Fatal("ApprovedAt is empty")
	}
}

func TestRepository_CompletePaymentOrderFromPOS_IsIdempotentWhenAlreadyDone(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-pos-2", 11000, "READY")

	approvedAt := time.Date(2026, 1, 10, 13, 0, 0, 0, time.UTC)
	first, err := testRepo.CompletePaymentOrderFromPOS(ctx, "order-pos-2", approvedAt, 1000, 10000, 0)
	if err != nil {
		t.Fatalf("first call error = %v", err)
	}

	second, err := testRepo.CompletePaymentOrderFromPOS(ctx, "order-pos-2", approvedAt, 1000, 10000, 0)
	if err != nil {
		t.Fatalf("second call (duplicate webhook) error = %v, want nil", err)
	}
	// PaymentOrder contains a slice (option choices) and so is not
	// comparable with ==; assert on the fields a duplicate delivery must
	// leave untouched instead.
	if second.Status != "DONE" || second.ApprovedAt != first.ApprovedAt ||
		second.PaymentMethod != first.PaymentMethod || second.VAT != first.VAT ||
		second.SuppliedAmount != first.SuppliedAmount || second.TaxFreeAmount != first.TaxFreeAmount {
		t.Fatalf("second call = %+v, want unchanged %+v", second, first)
	}
}

func TestRepository_CompletePaymentOrderFromPOS_RejectsAlreadyCancelledOrder(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-pos-3", 11000, "CANCELLED")

	_, err := testRepo.CompletePaymentOrderFromPOS(ctx, "order-pos-3", time.Now(), 1000, 10000, 0)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestRepository_CompletePaymentOrderFromPOS_UnknownOrderReturnsNotFound(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)

	_, err := testRepo.CompletePaymentOrderFromPOS(ctx, "does-not-exist", time.Now(), 1000, 10000, 0)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
}

func TestRepository_CancelPaymentOrder_CancelsReadyOrder(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-cancel-1", 11000, "READY")

	cancelledAt := time.Date(2026, 1, 10, 13, 0, 0, 0, time.UTC)
	order, err := testRepo.CancelPaymentOrder(ctx, "order-cancel-1", cancelledAt)
	if err != nil {
		t.Fatalf("CancelPaymentOrder() error = %v", err)
	}
	if order.Status != "CANCELLED" {
		t.Fatalf("Status = %q, want CANCELLED", order.Status)
	}
}

func TestRepository_CancelPaymentOrder_CancelsDoneOrder(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-cancel-2", 11000, "DONE")

	cancelledAt := time.Date(2026, 1, 10, 13, 0, 0, 0, time.UTC)
	order, err := testRepo.CancelPaymentOrder(ctx, "order-cancel-2", cancelledAt)
	if err != nil {
		t.Fatalf("CancelPaymentOrder() error = %v", err)
	}
	if order.Status != "CANCELLED" {
		t.Fatalf("Status = %q, want CANCELLED", order.Status)
	}
}

func TestRepository_CancelPaymentOrder_IsIdempotentWhenAlreadyCancelled(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-cancel-3", 11000, "CANCELLED")

	order, err := testRepo.CancelPaymentOrder(ctx, "order-cancel-3", time.Now())
	if err != nil {
		t.Fatalf("CancelPaymentOrder() error = %v, want nil (idempotent)", err)
	}
	if order.Status != "CANCELLED" {
		t.Fatalf("Status = %q, want CANCELLED", order.Status)
	}
}

func TestRepository_CancelPaymentOrder_UnknownOrderReturnsNotFound(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)

	_, err := testRepo.CancelPaymentOrder(ctx, "does-not-exist", time.Now())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
}

// resetPaymentOrdersTable truncates payment_orders between test cases in this
// file so seeded ids don't collide across tests sharing the docker-backed
// testPool (mirroring payment_list_query_integration_test.go's approach of
// seeding directly, but scoped to just this table since these tests don't
// touch menu/category rows).
func resetPaymentOrdersTable(t *testing.T, ctx context.Context) {
	t.Helper()
	if testPool == nil {
		t.Skip("docker not available; skipping integration test")
	}
	if _, err := testPool.Exec(ctx, `TRUNCATE payment_orders RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("truncate payment_orders: %v", err)
	}
}
