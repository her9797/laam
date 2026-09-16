package store

import (
	"context"
	"testing"
	"time"
)

func TestRepository_GetCustomerRequestPendingSummary_CountsPendingByKind(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createCustomerRequestsForListing(t, repo, ctx)

	summary, err := repo.GetCustomerRequestPendingSummary(ctx, 100)
	if err != nil {
		t.Fatalf("GetCustomerRequestPendingSummary() error = %v", err)
	}

	if summary.PendingGeneralCount != 1 {
		t.Errorf("PendingGeneralCount = %d, want 1", summary.PendingGeneralCount)
	}
	if summary.PendingSongCount != 1 {
		t.Errorf("PendingSongCount = %d, want 1", summary.PendingSongCount)
	}
	if len(summary.Items) != 2 {
		t.Fatalf("len(Items) = %d, want 2 (pending only)", len(summary.Items))
	}
	for _, item := range summary.Items {
		if item.Status != "pending" {
			t.Errorf("item %+v, want status=pending", item)
		}
	}
	if summary.Items[0].TableNumber != "T-02" || summary.Items[1].TableNumber != "T-01" {
		t.Errorf("items order = [%s, %s], want newest first [T-02, T-01]", summary.Items[0].TableNumber, summary.Items[1].TableNumber)
	}
}

func TestRepository_GetCustomerRequestPendingSummary_LimitsItemsButNotCounts(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	for _, table := range []string{"T-01", "T-02", "T-03"} {
		if err := repo.CreateCustomerRequest(ctx, table, "water"); err != nil {
			t.Fatalf("CreateCustomerRequest(%q) error = %v", table, err)
		}
		time.Sleep(idSpacingDelay)
	}

	summary, err := repo.GetCustomerRequestPendingSummary(ctx, 2)
	if err != nil {
		t.Fatalf("GetCustomerRequestPendingSummary() error = %v", err)
	}

	if summary.PendingGeneralCount != 3 || summary.PendingSongCount != 0 {
		t.Errorf("counts = (general %d, song %d), want (3, 0)", summary.PendingGeneralCount, summary.PendingSongCount)
	}
	if len(summary.Items) != 2 {
		t.Fatalf("len(Items) = %d, want 2", len(summary.Items))
	}
	if summary.Items[0].TableNumber != "T-03" || summary.Items[1].TableNumber != "T-02" {
		t.Errorf("items = [%s, %s], want the 2 newest [T-03, T-02]", summary.Items[0].TableNumber, summary.Items[1].TableNumber)
	}
}

func TestRepository_GetCustomerRequestPendingSummary_EmptyReturnsNonNilItems(t *testing.T) {
	repo := resetDB(t)

	summary, err := repo.GetCustomerRequestPendingSummary(context.Background(), 100)
	if err != nil {
		t.Fatalf("GetCustomerRequestPendingSummary() error = %v", err)
	}
	if summary.Items == nil || len(summary.Items) != 0 {
		t.Errorf("Items = %#v, want an empty non-nil slice", summary.Items)
	}
}
