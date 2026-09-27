package possync

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

var completionBase = time.Date(2026, 9, 20, 20, 0, 0, 0, time.UTC)

func line(title string, category string, price int64, quantity int64, options ...tossplace.OrderLineItemOptionChoice) tossplace.OrderLineItem {
	item := tossplace.OrderLineItem{Quantity: quantity, OptionChoices: options}
	item.Item.Title = title
	item.Item.Category.Title = category
	item.ItemPrice.PriceValue = price
	return item
}

func posRow(id string, posOrderID string, name string, amount int64, minute int, status string) store.POSRow {
	return store.POSRow{
		ID:           id,
		POSOrderID:   posOrderID,
		MenuItemName: name,
		CategoryName: "위스키",
		Status:       status,
		Amount:       amount,
		CreatedAt:    completionBase.Add(time.Duration(minute) * time.Minute),
	}
}

// fakeCompletionSource serves the store reads and TossPlace order fetches
// PlanOrderCompletion needs, and counts the fetches per order.
type fakeCompletionSource struct {
	rows       []store.POSRow
	orders     map[string]tossplace.Order
	orderErr   map[string]error
	fetches    map[string]int
	candidates struct{ from, to time.Time }
}

func (f *fakeCompletionSource) ListPOSRowsOnOrder(_ context.Context, posOrderID string) ([]store.POSRow, error) {
	out := make([]store.POSRow, 0)
	for _, row := range f.rows {
		if row.POSOrderID == posOrderID {
			out = append(out, row)
		}
	}
	return out, nil
}

func (f *fakeCompletionSource) ListPOSMoveCandidates(_ context.Context, posOrderID string, from, to time.Time) ([]store.POSRow, error) {
	f.candidates.from, f.candidates.to = from, to
	out := make([]store.POSRow, 0)
	for _, row := range f.rows {
		if row.POSOrderID != posOrderID && (row.Status == "READY" || row.Status == "ACKNOWLEDGED") &&
			!row.CreatedAt.Before(from) && row.CreatedAt.Before(to) {
			out = append(out, row)
		}
	}
	return out, nil
}

func (f *fakeCompletionSource) GetOrder(_ context.Context, id string) (tossplace.Order, error) {
	if f.fetches == nil {
		f.fetches = map[string]int{}
	}
	f.fetches[id]++
	if err := f.orderErr[id]; err != nil {
		return tossplace.Order{}, err
	}
	order, ok := f.orders[id]
	if !ok {
		return tossplace.Order{}, errors.New("unknown order " + id)
	}
	return order, nil
}

func completedOrder(id string, total int64, lines ...tossplace.OrderLineItem) tossplace.Order {
	return tossplace.Order{
		ID: id, OrderState: "COMPLETED", CompletedAt: "2026-09-20T21:00:00Z", OpenedAt: "2026-09-20T20:30:00Z",
		ChargePrice: tossplace.OrderChargePrice{TotalAmount: total}, LineItems: lines,
	}
}

var completionAt = completionBase.Add(time.Hour)

// Y completes first: 제임슨 is still linked to X but X's current lines no
// longer hold it, so Y adopts the row and records only 조니워커 as native.
func TestPlanOrderCompletion_AdoptsRowWhoseItemLeftItsOrigin(t *testing.T) {
	source := &fakeCompletionSource{
		rows: []store.POSRow{posRow("row-jameson", "pos-X", "제임슨", 10000, 0, "READY")},
		orders: map[string]tossplace.Order{
			"pos-X": {ID: "pos-X", OrderState: "OPEN", LineItems: []tossplace.OrderLineItem{}},
		},
	}
	orderY := completedOrder("pos-Y", 21000, line("조니워커 블랙", "위스키", 11000, 1), line("제임슨", "위스키", 10000, 1))

	got, err := PlanOrderCompletion(context.Background(), source, source, "pos-Y", orderY, completionAt)
	if err != nil {
		t.Fatalf("PlanOrderCompletion() error = %v", err)
	}
	assertIDs(t, "AdoptRowIDs", got.Plan.AdoptRowIDs, "row-jameson")
	assertIDs(t, "MoveOutRowIDs", got.Plan.MoveOutRowIDs)
	assertNatives(t, got.Plan.Natives, NativeLine{MenuItemName: "조니워커 블랙", CategoryName: "위스키", Amount: 11000})

	in := got.Input
	if in.POSOrderID != "pos-Y" || !in.CompletedAt.Equal(completionAt) {
		t.Fatalf("input = %+v, want pos-Y completed at %v", in, completionAt)
	}
	if in.TotalAmount == nil || *in.TotalAmount != 21000 || in.DiscountAmount == nil || *in.DiscountAmount != 0 {
		t.Fatalf("charge = %v/%v, want 21000/0", in.TotalAmount, in.DiscountAmount)
	}
	if len(in.Natives) != 1 || in.Natives[0].Amount != 11000 || in.Natives[0].VAT != 1000 || in.Natives[0].SuppliedAmount != 10000 ||
		!in.Natives[0].ApprovedAt.Equal(time.Date(2026, 9, 20, 21, 0, 0, 0, time.UTC)) ||
		!in.Natives[0].OrderedAt.Equal(time.Date(2026, 9, 20, 20, 30, 0, 0, time.UTC)) {
		t.Fatalf("natives = %+v, want 조니워커 11000 approved at the order's completedAt, ordered at openedAt", in.Natives)
	}
	if want := completionAt.Add(-24 * time.Hour); !source.candidates.from.Equal(want) {
		t.Fatalf("candidate window from = %v, want %v", source.candidates.from, want)
	}
	if want := completionAt.Add(5 * time.Minute); !source.candidates.to.Equal(want) {
		t.Fatalf("candidate window to = %v, want %v", source.candidates.to, want)
	}
}

// X completes first: its 제임슨 row is not in X's final lines, so it moves
// out and 고독 is native. Rows already DONE count as matched lines and are
// never recorded again; cancelled and moved-out rows are not on the order.
func TestPlanOrderCompletion_MovesOutRowsMissingFromFinalLines(t *testing.T) {
	moved := posRow("row-moved", "pos-X", "하이볼", 9000, 1, "READY")
	moved.MovedOutAt = completionBase
	source := &fakeCompletionSource{rows: []store.POSRow{
		posRow("row-jameson", "pos-X", "제임슨", 10000, 0, "READY"),
		posRow("row-native", "pos-X", "생맥주", 6000, 2, "DONE"),
		posRow("row-cancelled", "pos-X", "고독", 15000, 3, "CANCELLED"),
		moved,
	}}
	orderX := completedOrder("pos-X", 21000, line("고독", "기타", 15000, 1), line("생맥주", "맥주", 6000, 1))

	got, err := PlanOrderCompletion(context.Background(), source, source, "pos-X", orderX, completionAt)
	if err != nil {
		t.Fatalf("PlanOrderCompletion() error = %v", err)
	}
	assertIDs(t, "CompleteRowIDs", got.Plan.CompleteRowIDs, "row-native")
	assertIDs(t, "MoveOutRowIDs", got.Plan.MoveOutRowIDs, "row-jameson")
	assertIDs(t, "AdoptRowIDs", got.Plan.AdoptRowIDs)
	assertNatives(t, got.Plan.Natives, NativeLine{MenuItemName: "고독", CategoryName: "기타", Amount: 15000})
	if got.RowsOnOrder != 4 {
		t.Fatalf("RowsOnOrder = %d, want every row linked to the order (4)", got.RowsOnOrder)
	}
}

// Two identical 하이볼 rows on X, one of which staff moved to Y: X still
// shows one unit, so exactly one row (deterministically the newer one) is
// gone and Y adopts it. X is fetched once for both candidates.
func TestPlanOrderCompletion_DuplicateItemsOnOriginAdoptOnlyTheMovedUnits(t *testing.T) {
	source := &fakeCompletionSource{
		rows: []store.POSRow{
			posRow("row-a", "pos-X", "하이볼", 9000, 0, "READY"),
			posRow("row-b", "pos-X", "하이볼", 9000, 1, "READY"),
		},
		orders: map[string]tossplace.Order{
			"pos-X": {ID: "pos-X", OrderState: "OPEN", LineItems: []tossplace.OrderLineItem{line("하이볼", "위스키", 9000, 1)}},
		},
	}
	orderY := completedOrder("pos-Y", 9000, line("하이볼", "위스키", 9000, 1))

	got, err := PlanOrderCompletion(context.Background(), source, source, "pos-Y", orderY, completionAt)
	if err != nil {
		t.Fatalf("PlanOrderCompletion() error = %v", err)
	}
	assertIDs(t, "AdoptRowIDs", got.Plan.AdoptRowIDs, "row-b")
	assertNatives(t, got.Plan.Natives)
	if source.fetches["pos-X"] != 1 {
		t.Fatalf("pos-X fetched %d times, want once (cached per call)", source.fetches["pos-X"])
	}
}

// A quantity-2 line on the origin still holds both rows: nothing moved.
func TestRowsStillOnOrder_CountsQuantityUnitsAndDoneRowsFirst(t *testing.T) {
	rows := []store.POSRow{
		posRow("row-ready-old", "pos-X", "하이볼", 9000, 0, "READY"),
		posRow("row-done", "pos-X", "하이볼", 9000, 5, "DONE"),
		posRow("row-ready-new", "pos-X", "하이볼", 9000, 9, "READY"),
		posRow("row-cancelled", "pos-X", "하이볼", 9000, 1, "CANCELLED"),
	}
	still := rowsStillOnOrder([]tossplace.OrderLineItem{line("하이볼", "위스키", 9000, 2)}, rows)
	if !still["row-done"] || !still["row-ready-old"] || still["row-ready-new"] || still["row-cancelled"] {
		t.Fatalf("still = %v, want the DONE row and the oldest READY row", still)
	}
}

// An origin that cannot be fetched is not guessed: the error comes back so
// the completion is retried later.
func TestPlanOrderCompletion_ReturnsOriginLookupError(t *testing.T) {
	lookupErr := errors.New("tossplace unavailable")
	source := &fakeCompletionSource{
		rows:     []store.POSRow{posRow("row-jameson", "pos-X", "제임슨", 10000, 0, "READY")},
		orderErr: map[string]error{"pos-X": lookupErr},
	}
	orderY := completedOrder("pos-Y", 21000, line("조니워커 블랙", "위스키", 11000, 1), line("제임슨", "위스키", 10000, 1))

	if _, err := PlanOrderCompletion(context.Background(), source, source, "pos-Y", orderY, completionAt); !errors.Is(err, lookupErr) {
		t.Fatalf("PlanOrderCompletion() error = %v, want the origin lookup error", err)
	}
}

// A completed order reported with a charge but no line items is missing
// its lines, not empty: the rows on it complete as before instead of all
// moving out.
func TestPlanOrderCompletion_OrderWithChargeButNoLinesCompletesItsRows(t *testing.T) {
	source := &fakeCompletionSource{rows: []store.POSRow{
		posRow("row-1", "pos-P", "하이볼", 9000, 0, "READY"),
		posRow("row-2", "pos-P", "제임슨", 10000, 1, "DONE"),
	}}
	got, err := PlanOrderCompletion(context.Background(), source, source, "pos-P", completedOrder("pos-P", 19000), completionAt)
	if err != nil {
		t.Fatalf("PlanOrderCompletion() error = %v", err)
	}
	assertIDs(t, "CompleteRowIDs", got.Plan.CompleteRowIDs, "row-1", "row-2")
	assertIDs(t, "MoveOutRowIDs", got.Plan.MoveOutRowIDs)
	assertNatives(t, got.Plan.Natives)
}
