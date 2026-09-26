package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

type fakeSource struct {
	ids   []string
	snaps map[string]Snapshot
}

func (f fakeSource) ListPOSOrderIDsForBackfill(context.Context) ([]string, error) {
	return f.ids, nil
}

func (f fakeSource) LoadSnapshot(_ context.Context, posOrderID string, _ []string) (Snapshot, error) {
	return f.snaps[posOrderID], nil
}

type fakePOS struct {
	orders   map[string]tossplace.Order
	payments map[string][]tossplace.Payment
}

func (f fakePOS) GetOrder(_ context.Context, id string) (tossplace.Order, error) {
	return f.orders[id], nil
}

func (f fakePOS) GetPaymentsByOrderID(_ context.Context, id string) ([]tossplace.Payment, error) {
	return f.payments[id], nil
}

type spyWriter struct{ calls []string }

func (s *spyWriter) EnsurePOSBill(_ context.Context, id string) (string, error) {
	s.calls = append(s.calls, "EnsurePOSBill "+id)
	return "bill-" + id, nil
}

func (s *spyWriter) SetPOSBillCharge(_ context.Context, id string, _ int64, _ int64) error {
	s.calls = append(s.calls, "SetPOSBillCharge "+id)
	return nil
}

func (s *spyWriter) CompletePOSBill(_ context.Context, input store.CompletePOSBillInput) (string, bool, error) {
	s.calls = append(s.calls, "CompletePOSBill "+input.POSOrderID)
	return "bill-" + input.POSOrderID, true, nil
}

func (s *spyWriter) CancelPOSBill(_ context.Context, id string, _ string, _ time.Time) (bool, error) {
	s.calls = append(s.calls, "CancelPOSBill "+id)
	return true, nil
}

func (s *spyWriter) UpsertPOSPayments(_ context.Context, id string, _ []store.POSPaymentInput, fullSync bool) error {
	if fullSync {
		s.calls = append(s.calls, "UpsertPOSPayments(full) "+id)
	} else {
		s.calls = append(s.calls, "UpsertPOSPayments(partial) "+id)
	}
	return nil
}

func twoOrderFixture() (fakeSource, fakePOS) {
	source := fakeSource{
		ids: []string{"pos-a", "pos-b"},
		snaps: map[string]Snapshot{
			"pos-a": {Rows: []SnapshotRow{{ID: "o1", Status: "DONE", Amount: 1000}, {ID: "o2", Status: "READY", Amount: 2000}}},
			"pos-b": {Rows: []SnapshotRow{{ID: "o3", Status: "READY", Amount: 3000}}},
		},
	}
	pos := fakePOS{
		orders: map[string]tossplace.Order{
			"pos-a": {ID: "pos-a", OrderState: "COMPLETED", CompletedAt: "2026-09-01T13:00:00Z", ChargePrice: tossplace.OrderChargePrice{TotalAmount: 3000}},
			"pos-b": {ID: "pos-b", OrderState: "OPENED"},
		},
		payments: map[string][]tossplace.Payment{
			"pos-a": {{ID: "pay-1", State: "APPROVED", SourceType: "CARD", Amount: 3000, ApprovedAt: "2026-09-01T13:00:00Z"}},
		},
	}
	return source, pos
}

func TestRunner_DryRunNeverCallsTheWriter(t *testing.T) {
	source, pos := twoOrderFixture()
	writer := &spyWriter{}
	var out bytes.Buffer
	runner := &Runner{Source: source, POS: pos, Writer: writer, Out: &out, Sleep: func(context.Context, time.Duration) error { return nil }}

	summary, err := runner.Run(context.Background(), Options{Apply: false})
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if len(writer.calls) != 0 {
		t.Fatalf("dry-run called the writer: %v", writer.calls)
	}
	if summary.BillsToCreate != 2 || summary.RowsToDone != 1 || summary.RowsToDoneAmount != 2000 {
		t.Fatalf("summary = %+v, want 2 bills to create and 1 row (2000) to DONE", summary)
	}
	if !strings.Contains(out.String(), "DRY-RUN") {
		t.Fatalf("output missing DRY-RUN marker:\n%s", out.String())
	}
}

func TestRunner_ApplyWritesInOrderAndOnlyFullSyncsFinishedBills(t *testing.T) {
	source, pos := twoOrderFixture()
	writer := &spyWriter{}
	runner := &Runner{Source: source, POS: pos, Writer: writer, Out: &bytes.Buffer{}, Sleep: func(context.Context, time.Duration) error { return nil }}

	if _, err := runner.Run(context.Background(), Options{Apply: true}); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	want := []string{
		"EnsurePOSBill pos-a", "SetPOSBillCharge pos-a", "CompletePOSBill pos-a", "UpsertPOSPayments(full) pos-a",
		"EnsurePOSBill pos-b", "SetPOSBillCharge pos-b", "UpsertPOSPayments(partial) pos-b",
	}
	if strings.Join(writer.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("writer calls =\n%s\nwant\n%s", strings.Join(writer.calls, "\n"), strings.Join(want, "\n"))
	}
}

func TestRunner_WaitsTheConfiguredDelayBetweenTossPlaceCalls(t *testing.T) {
	source, pos := twoOrderFixture()
	var waits []time.Duration
	runner := &Runner{Source: source, POS: pos, Out: &bytes.Buffer{}, Sleep: func(_ context.Context, d time.Duration) error {
		waits = append(waits, d)
		return nil
	}}

	if _, err := runner.Run(context.Background(), Options{Delay: 150 * time.Millisecond}); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	// Two orders x (GetOrder + GetPaymentsByOrderID) = 4 calls, 3 gaps.
	if len(waits) != 3 {
		t.Fatalf("waits = %v, want 3 waits between 4 TossPlace calls", waits)
	}
	for _, d := range waits {
		if d != 150*time.Millisecond {
			t.Fatalf("wait = %v, want 150ms", d)
		}
	}
}

func TestRunner_ApplyWithoutWriterIsRejected(t *testing.T) {
	source, pos := twoOrderFixture()
	runner := &Runner{Source: source, POS: pos, Out: &bytes.Buffer{}}
	if _, err := runner.Run(context.Background(), Options{Apply: true}); err == nil {
		t.Fatal("Run(Apply) without a writer succeeded, want an error")
	}
}
