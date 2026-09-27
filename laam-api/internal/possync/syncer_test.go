package possync

import (
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/tossplace"
)

// A payment TossPlace reports without approvedAt still has to land on a
// day in the payment-based stats, so its creation time stands in.
func TestPaymentInputFallsBackToCreatedAtWhenApprovedAtIsMissing(t *testing.T) {
	input := paymentInput(tossplace.Payment{ID: "pay-1", State: "APPROVED", Amount: 1000, CreatedAt: "2026-09-01T13:00:00Z"})
	if want := time.Date(2026, 9, 1, 13, 0, 0, 0, time.UTC); !input.ApprovedAt.Equal(want) {
		t.Fatalf("ApprovedAt = %v, want createdAt %v", input.ApprovedAt, want)
	}

	input = paymentInput(tossplace.Payment{ID: "pay-2", State: "APPROVED", ApprovedAt: "2026-09-01T12:00:00Z", CreatedAt: "2026-09-01T13:00:00Z"})
	if want := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC); !input.ApprovedAt.Equal(want) {
		t.Fatalf("ApprovedAt = %v, want approvedAt %v", input.ApprovedAt, want)
	}
}
