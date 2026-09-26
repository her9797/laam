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

func TestRepository_CreatePOSNativeOrder_RecordsADoneSale(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)

	approvedAt := time.Date(2026, 1, 10, 13, 0, 0, 0, time.UTC)
	order, err := testRepo.CreatePOSNativeOrder(ctx, CreatePOSNativeOrderInput{
		MenuItemName:   "하우스 하이볼",
		CategoryName:   "하이볼",
		Amount:         10000,
		ApprovedAt:     approvedAt,
		VAT:            909,
		SuppliedAmount: 9091,
		POSOrderID:     "pos-order-9",
	})
	if err != nil {
		t.Fatalf("CreatePOSNativeOrder() error = %v", err)
	}
	if order.Status != "DONE" || order.PaymentMethod != "POS" {
		t.Fatalf("status = %q paymentMethod = %q, want DONE/POS", order.Status, order.PaymentMethod)
	}
	if order.MenuItemID != "" {
		t.Fatalf("MenuItemID = %q, want empty (no catalog link)", order.MenuItemID)
	}
	if order.MenuItemName != "하우스 하이볼" || order.CategoryName != "하이볼" {
		t.Fatalf("menuItemName/categoryName = %q/%q", order.MenuItemName, order.CategoryName)
	}
	if order.Amount != 10000 || order.VAT != 909 || order.SuppliedAmount != 9091 {
		t.Fatalf("amounts = %d/%d/%d, want 10000/909/9091", order.Amount, order.VAT, order.SuppliedAmount)
	}
	if order.POSOrderID != "pos-order-9" || order.POSSyncStatus != "SUCCEEDED" {
		t.Fatalf("posOrderId = %q posSyncStatus = %q", order.POSOrderID, order.POSSyncStatus)
	}
}

func TestRepository_CreatePOSNativeOrder_RejectsNonPositiveAmount(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)

	_, err := testRepo.CreatePOSNativeOrder(ctx, CreatePOSNativeOrderInput{
		MenuItemName: "하우스 하이볼",
		CategoryName: "하이볼",
		Amount:       0,
		ApprovedAt:   time.Now(),
		POSOrderID:   "pos-order-10",
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestRepository_HasPaymentOrderWithPOSOrderID(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)

	before, err := testRepo.HasPaymentOrderWithPOSOrderID(ctx, "pos-order-11")
	if err != nil {
		t.Fatalf("HasPaymentOrderWithPOSOrderID() error = %v", err)
	}
	if before {
		t.Fatal("HasPaymentOrderWithPOSOrderID() = true before any row exists")
	}

	if _, err := testRepo.CreatePOSNativeOrder(ctx, CreatePOSNativeOrderInput{
		MenuItemName: "하우스 하이볼",
		CategoryName: "하이볼",
		Amount:       10000,
		ApprovedAt:   time.Now(),
		POSOrderID:   "pos-order-11",
	}); err != nil {
		t.Fatalf("seed CreatePOSNativeOrder() error = %v", err)
	}

	after, err := testRepo.HasPaymentOrderWithPOSOrderID(ctx, "pos-order-11")
	if err != nil {
		t.Fatalf("HasPaymentOrderWithPOSOrderID() error = %v", err)
	}
	if !after {
		t.Fatal("HasPaymentOrderWithPOSOrderID() = false after the row was created")
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
	if _, err := testPool.Exec(ctx, `TRUNCATE pos_payments, pos_bills, payment_orders RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("truncate payment_orders: %v", err)
	}
}

// A POS-native order's created_at must be the moment the POS opened the
// order (TossPlace's openedAt), not the moment our webhook handler ran —
// the admin order list reads created_at as "주문 시각".
func TestRepository_CreatePOSNativeOrder_UsesOrderedAtAsCreatedAt(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)

	orderedAt := time.Date(2026, 1, 10, 12, 40, 0, 0, time.UTC)
	order, err := testRepo.CreatePOSNativeOrder(ctx, CreatePOSNativeOrderInput{
		MenuItemName:   "하우스 하이볼",
		CategoryName:   "하이볼",
		Amount:         10000,
		OrderedAt:      orderedAt,
		ApprovedAt:     orderedAt.Add(20 * time.Minute),
		VAT:            909,
		SuppliedAmount: 9091,
		POSOrderID:     "pos-order-ordered-at",
	})
	if err != nil {
		t.Fatalf("CreatePOSNativeOrder() error = %v", err)
	}
	if order.CreatedAt != orderedAt.Format(time.RFC3339) {
		t.Fatalf("createdAt = %q, want %q", order.CreatedAt, orderedAt.Format(time.RFC3339))
	}
	if order.ApprovedAt != orderedAt.Add(20*time.Minute).Format(time.RFC3339) {
		t.Fatalf("approvedAt = %q, want the completion time", order.ApprovedAt)
	}
}

// TossPlace may omit openedAt; the row must still land with a sane
// created_at rather than the zero time.
func TestRepository_CreatePOSNativeOrder_FallsBackToNowWhenOrderedAtMissing(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)

	before := time.Now().UTC().Add(-time.Minute)
	order, err := testRepo.CreatePOSNativeOrder(ctx, CreatePOSNativeOrderInput{
		MenuItemName:   "하우스 하이볼",
		CategoryName:   "하이볼",
		Amount:         10000,
		ApprovedAt:     time.Now().UTC(),
		VAT:            909,
		SuppliedAmount: 9091,
		POSOrderID:     "pos-order-no-opened-at",
	})
	if err != nil {
		t.Fatalf("CreatePOSNativeOrder() error = %v", err)
	}
	createdAt, err := time.Parse(time.RFC3339, order.CreatedAt)
	if err != nil {
		t.Fatalf("createdAt = %q, not RFC3339: %v", order.CreatedAt, err)
	}
	if createdAt.Before(before) {
		t.Fatalf("createdAt = %q, want a recent timestamp", order.CreatedAt)
	}
}
