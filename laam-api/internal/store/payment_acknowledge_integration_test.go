package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRepository_AcknowledgePaymentOrder_MarksReadyOrderAcknowledged(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-ack-1", 11000, "READY")

	order, err := testRepo.AcknowledgePaymentOrder(ctx, "order-ack-1")
	if err != nil {
		t.Fatalf("AcknowledgePaymentOrder() error = %v", err)
	}
	if order.Status != "ACKNOWLEDGED" {
		t.Fatalf("Status = %q, want ACKNOWLEDGED", order.Status)
	}
}

func TestRepository_AcknowledgePaymentOrder_IsIdempotentWhenAlreadyAcknowledged(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-ack-2", 11000, "ACKNOWLEDGED")

	order, err := testRepo.AcknowledgePaymentOrder(ctx, "order-ack-2")
	if err != nil {
		t.Fatalf("AcknowledgePaymentOrder() error = %v, want nil (idempotent)", err)
	}
	if order.Status != "ACKNOWLEDGED" {
		t.Fatalf("Status = %q, want ACKNOWLEDGED", order.Status)
	}
}

func TestRepository_AcknowledgePaymentOrder_RejectsDoneOrder(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-ack-3", 11000, "DONE")

	_, err := testRepo.AcknowledgePaymentOrder(ctx, "order-ack-3")
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestRepository_AcknowledgePaymentOrder_RejectsCancelledOrder(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-ack-4", 11000, "CANCELLED")

	_, err := testRepo.AcknowledgePaymentOrder(ctx, "order-ack-4")
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestRepository_AcknowledgePaymentOrder_UnknownOrderReturnsNotFound(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)

	_, err := testRepo.AcknowledgePaymentOrder(ctx, "does-not-exist")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
}

func TestRepository_CompletePaymentOrderFromPOS_MarksAcknowledgedOrderDone(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-ack-done-1", 11000, "ACKNOWLEDGED")

	order, err := testRepo.CompletePaymentOrderFromPOS(ctx, "order-ack-done-1", time.Now(), 1000, 10000, 0)
	if err != nil {
		t.Fatalf("CompletePaymentOrderFromPOS() error = %v", err)
	}
	if order.Status != "DONE" {
		t.Fatalf("Status = %q, want DONE", order.Status)
	}
}

func TestRepository_CancelPaymentOrder_CancelsAcknowledgedOrder(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedPOSPaymentOrder(t, ctx, "order-ack-cancel-1", 11000, "ACKNOWLEDGED")

	order, err := testRepo.CancelPaymentOrder(ctx, "order-ack-cancel-1", time.Now())
	if err != nil {
		t.Fatalf("CancelPaymentOrder() error = %v", err)
	}
	if order.Status != "CANCELLED" {
		t.Fatalf("Status = %q, want CANCELLED", order.Status)
	}
}
