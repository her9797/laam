package possync

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/tossplace"
)

var reconcileBase = time.Date(2026, 9, 20, 20, 0, 0, 0, time.UTC)

func rowRef(id string, posOrderID string, name string, amount int64, minute int, movedOut bool) RowRef {
	return RowRef{
		ID:           id,
		POSOrderID:   posOrderID,
		MenuItemName: name,
		Amount:       amount,
		CreatedAt:    reconcileBase.Add(time.Duration(minute) * time.Minute),
		MovedOut:     movedOut,
	}
}

// fakeOrigin answers StillOnOrigin from a fixed map and records every call.
type fakeOrigin struct {
	still map[string]bool
	err   error
	calls []string
}

func (f *fakeOrigin) lookup(_ context.Context, row RowRef) (bool, error) {
	f.calls = append(f.calls, row.ID)
	if f.err != nil {
		return false, f.err
	}
	still, ok := f.still[row.ID]
	if !ok {
		return false, errors.New("unexpected lookup for " + row.ID)
	}
	return still, nil
}

func noLookup(t *testing.T) StillOnOrigin {
	t.Helper()
	return func(_ context.Context, row RowRef) (bool, error) {
		t.Fatalf("stillOnOrigin called for %s, want no lookup", row.ID)
		return false, nil
	}
}

func assertIDs(t *testing.T, field string, got []string, want ...string) {
	t.Helper()
	if len(got) == 0 && len(want) == 0 {
		return
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s = %v, want %v", field, got, want)
	}
}

func assertNatives(t *testing.T, got []NativeLine, want ...NativeLine) {
	t.Helper()
	if len(got) == 0 && len(want) == 0 {
		return
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Natives = %+v, want %+v", got, want)
	}
}

// Production case: web 제임슨 was linked to POS order X, but staff paid it
// together with 조니워커 블랙 on POS order Y ("한 번에 결제").
var (
	jamesonRow  = rowRef("row-jameson", "pos-X", "제임슨", 10000, 0, false)
	linesOrderY = []tossplace.OrderLineItem{
		line("조니워커 블랙", "위스키", 11000, 1),
		line("제임슨", "위스키", 10000, 1),
	}
	linesOrderX = []tossplace.OrderLineItem{line("고독", "칵테일", 15000, 1)}
)

func TestPlanCompletion_OrderYAdoptsItemMovedFromOrderX(t *testing.T) {
	origin := &fakeOrigin{still: map[string]bool{"row-jameson": false}}

	plan, err := PlanCompletion(context.Background(), linesOrderY, nil, []RowRef{jamesonRow}, origin.lookup)
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "CompleteRowIDs", plan.CompleteRowIDs)
	assertIDs(t, "MoveOutRowIDs", plan.MoveOutRowIDs)
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs, "row-jameson")
	assertNatives(t, plan.Natives, NativeLine{MenuItemName: "조니워커 블랙", CategoryName: "위스키", Amount: 11000})
	assertIDs(t, "stillOnOrigin calls", origin.calls, "row-jameson")
}

func TestPlanCompletion_OrderXMovesOutItemPaidElsewhere(t *testing.T) {
	plan, err := PlanCompletion(context.Background(), linesOrderX, []RowRef{jamesonRow}, nil, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "CompleteRowIDs", plan.CompleteRowIDs)
	assertIDs(t, "MoveOutRowIDs", plan.MoveOutRowIDs, "row-jameson")
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs)
	assertNatives(t, plan.Natives, NativeLine{MenuItemName: "고독", CategoryName: "칵테일", Amount: 15000})
}

func TestPlanCompletion_MovedItemReconcilesInEitherCompletionOrder(t *testing.T) {
	ctx := context.Background()

	t.Run("X completes before Y", func(t *testing.T) {
		planX, err := PlanCompletion(ctx, linesOrderX, []RowRef{jamesonRow}, nil, noLookup(t))
		if err != nil {
			t.Fatalf("PlanCompletion(X) error = %v", err)
		}
		assertIDs(t, "X.MoveOutRowIDs", planX.MoveOutRowIDs, "row-jameson")
		assertNatives(t, planX.Natives, NativeLine{MenuItemName: "고독", CategoryName: "칵테일", Amount: 15000})

		// The caller flags the row as moved out; Y must adopt it without a lookup.
		movedOut := jamesonRow
		movedOut.MovedOut = true
		planY, err := PlanCompletion(ctx, linesOrderY, nil, []RowRef{movedOut}, noLookup(t))
		if err != nil {
			t.Fatalf("PlanCompletion(Y) error = %v", err)
		}
		assertIDs(t, "Y.AdoptRowIDs", planY.AdoptRowIDs, "row-jameson")
		assertNatives(t, planY.Natives, NativeLine{MenuItemName: "조니워커 블랙", CategoryName: "위스키", Amount: 11000})
	})

	t.Run("Y completes before X", func(t *testing.T) {
		origin := &fakeOrigin{still: map[string]bool{"row-jameson": false}}
		planY, err := PlanCompletion(ctx, linesOrderY, nil, []RowRef{jamesonRow}, origin.lookup)
		if err != nil {
			t.Fatalf("PlanCompletion(Y) error = %v", err)
		}
		assertIDs(t, "Y.AdoptRowIDs", planY.AdoptRowIDs, "row-jameson")
		assertNatives(t, planY.Natives, NativeLine{MenuItemName: "조니워커 블랙", CategoryName: "위스키", Amount: 11000})

		// The caller relinks the row to Y, so X no longer has it on order.
		planX, err := PlanCompletion(ctx, linesOrderX, nil, nil, noLookup(t))
		if err != nil {
			t.Fatalf("PlanCompletion(X) error = %v", err)
		}
		assertIDs(t, "X.MoveOutRowIDs", planX.MoveOutRowIDs)
		assertIDs(t, "X.AdoptRowIDs", planX.AdoptRowIDs)
		assertNatives(t, planX.Natives, NativeLine{MenuItemName: "고독", CategoryName: "칵테일", Amount: 15000})
	})
}

func TestPlanCompletion_OwnOrderFallsBackToAmountOnlyMatch(t *testing.T) {
	lines := []tossplace.OrderLineItem{line("하이볼(POS명)", "하이볼", 11000, 1)}
	onOrder := []RowRef{rowRef("row-highball", "pos-A", "하우스 하이볼", 11000, 0, false)}

	plan, err := PlanCompletion(context.Background(), lines, onOrder, nil, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "CompleteRowIDs", plan.CompleteRowIDs, "row-highball")
	assertIDs(t, "MoveOutRowIDs", plan.MoveOutRowIDs)
	assertNatives(t, plan.Natives)
}

func TestPlanCompletion_AdoptionRequiresSameName(t *testing.T) {
	lines := []tossplace.OrderLineItem{line("하이볼(POS명)", "하이볼", 11000, 1)}
	candidates := []RowRef{rowRef("row-highball", "pos-A", "하우스 하이볼", 11000, 0, true)}

	plan, err := PlanCompletion(context.Background(), lines, nil, candidates, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs)
	assertNatives(t, plan.Natives, NativeLine{MenuItemName: "하이볼(POS명)", CategoryName: "하이볼", Amount: 11000})
}

func TestPlanCompletion_DoesNotAdoptItemStillOnOrigin(t *testing.T) {
	origin := &fakeOrigin{still: map[string]bool{"row-jameson": true}}

	plan, err := PlanCompletion(context.Background(), linesOrderY, nil, []RowRef{jamesonRow}, origin.lookup)
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs)
	assertNatives(t, plan.Natives,
		NativeLine{MenuItemName: "조니워커 블랙", CategoryName: "위스키", Amount: 11000},
		NativeLine{MenuItemName: "제임슨", CategoryName: "위스키", Amount: 10000},
	)
}

func TestPlanCompletion_PrefersMovedOutCandidateWithoutLookup(t *testing.T) {
	lines := []tossplace.OrderLineItem{line("제임슨", "위스키", 10000, 1)}
	candidates := []RowRef{
		rowRef("row-older-unknown", "pos-X", "제임슨", 10000, 0, false),
		rowRef("row-newer-moved", "pos-Z", "제임슨", 10000, 5, true),
	}

	plan, err := PlanCompletion(context.Background(), lines, nil, candidates, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs, "row-newer-moved")
	assertNatives(t, plan.Natives)
}

func TestPlanCompletion_PropagatesLookupError(t *testing.T) {
	lookupErr := errors.New("tossplace unavailable")
	origin := &fakeOrigin{err: lookupErr}

	_, err := PlanCompletion(context.Background(), linesOrderY, nil, []RowRef{jamesonRow}, origin.lookup)
	if !errors.Is(err, lookupErr) {
		t.Fatalf("PlanCompletion() error = %v, want %v", err, lookupErr)
	}
}

func TestPlanCompletion_CachesLookupPerRow(t *testing.T) {
	lines := []tossplace.OrderLineItem{
		line("제임슨", "위스키", 10000, 1),
		line("제임슨", "위스키", 10000, 1),
	}
	origin := &fakeOrigin{still: map[string]bool{"row-jameson": true}}

	plan, err := PlanCompletion(context.Background(), lines, nil, []RowRef{jamesonRow}, origin.lookup)
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs)
	assertIDs(t, "stillOnOrigin calls", origin.calls, "row-jameson")
	if len(plan.Natives) != 2 {
		t.Fatalf("Natives = %+v, want both 제임슨 lines", plan.Natives)
	}
}

func TestPlanCompletion_QuantityLineMatchesMultipleWebRows(t *testing.T) {
	lines := []tossplace.OrderLineItem{line("생맥주", "맥주", 6000, 2)}
	onOrder := []RowRef{
		rowRef("row-beer-1", "pos-A", "생맥주", 6000, 0, false),
		rowRef("row-beer-2", "pos-A", "생맥주", 6000, 1, false),
	}

	plan, err := PlanCompletion(context.Background(), lines, onOrder, nil, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "CompleteRowIDs", plan.CompleteRowIDs, "row-beer-1", "row-beer-2")
	assertIDs(t, "MoveOutRowIDs", plan.MoveOutRowIDs)
	assertNatives(t, plan.Natives)
}

func TestPlanCompletion_RecombinesLeftoverQuantityIntoOneNative(t *testing.T) {
	lines := []tossplace.OrderLineItem{
		line("생맥주", "맥주", 5000, 4, tossplace.OrderLineItemOptionChoice{Title: "라지", PriceValue: 1000, Quantity: 4}),
	}
	onOrder := []RowRef{rowRef("row-beer", "pos-A", "생맥주", 6000, 0, false)}
	candidates := []RowRef{rowRef("row-beer-moved", "pos-B", "생맥주", 6000, 1, true)}

	plan, err := PlanCompletion(context.Background(), lines, onOrder, candidates, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "CompleteRowIDs", plan.CompleteRowIDs, "row-beer")
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs, "row-beer-moved")
	assertNatives(t, plan.Natives, NativeLine{MenuItemName: "생맥주", CategoryName: "맥주", Amount: 12000})
}

func TestPlanCompletion_IndivisibleQuantityLineStaysWhole(t *testing.T) {
	// 10001 does not split evenly into 2 units, so the line is one unit.
	lines := []tossplace.OrderLineItem{
		line("생맥주", "맥주", 5000, 2, tossplace.OrderLineItemOptionChoice{Title: "추가", PriceValue: 1, Quantity: 1}),
	}
	onOrder := []RowRef{rowRef("row-beer", "pos-A", "생맥주", 5000, 0, false)}

	plan, err := PlanCompletion(context.Background(), lines, onOrder, nil, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "MoveOutRowIDs", plan.MoveOutRowIDs, "row-beer")
	assertNatives(t, plan.Natives, NativeLine{MenuItemName: "생맥주", CategoryName: "맥주", Amount: 10001})
}

func TestPlanCompletion_DuplicateCandidatesAdoptOldestFirst(t *testing.T) {
	lines := []tossplace.OrderLineItem{line("제임슨", "위스키", 10000, 1)}
	candidates := []RowRef{
		rowRef("row-newer", "pos-X", "제임슨", 10000, 10, false),
		rowRef("row-older", "pos-X", "제임슨", 10000, 1, false),
	}
	origin := &fakeOrigin{still: map[string]bool{"row-newer": false, "row-older": false}}

	plan, err := PlanCompletion(context.Background(), lines, nil, candidates, origin.lookup)
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs, "row-older")
	assertIDs(t, "stillOnOrigin calls", origin.calls, "row-older")
	assertNatives(t, plan.Natives)
}

func TestPlanCompletion_CandidateAdoptedAtMostOnce(t *testing.T) {
	lines := []tossplace.OrderLineItem{line("제임슨", "위스키", 10000, 2)}
	candidates := []RowRef{rowRef("row-jameson", "pos-X", "제임슨", 10000, 0, true)}

	plan, err := PlanCompletion(context.Background(), lines, nil, candidates, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs, "row-jameson")
	assertNatives(t, plan.Natives, NativeLine{MenuItemName: "제임슨", CategoryName: "위스키", Amount: 10000})
}

func TestPlanCompletion_IgnoresNonPositiveLines(t *testing.T) {
	lines := []tossplace.OrderLineItem{
		line("서비스 안주", "안주", 0, 1),
		line("할인", "할인", -3000, 1),
		line("생맥주", "맥주", 6000, 1),
	}
	onOrder := []RowRef{rowRef("row-free", "pos-A", "서비스 안주", 0, 0, false)}

	plan, err := PlanCompletion(context.Background(), lines, onOrder, nil, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "CompleteRowIDs", plan.CompleteRowIDs)
	assertIDs(t, "MoveOutRowIDs", plan.MoveOutRowIDs, "row-free")
	assertNatives(t, plan.Natives, NativeLine{MenuItemName: "생맥주", CategoryName: "맥주", Amount: 6000})
}

// A quantity line recorded earlier as ONE POS-native row (생맥주 x2 =
// 12,000) is already represented on a re-run: the row matches the whole
// line, so nothing is recorded again and no candidate is looked up for
// its units.
func TestPlanCompletion_RecordedQuantityNativeMatchesItsWholeLine(t *testing.T) {
	lines := []tossplace.OrderLineItem{line("하우스 하이볼", "하이볼", 11000, 1), line("생맥주", "맥주", 6000, 2)}
	onOrder := []RowRef{
		rowRef("row-web", "pos-A", "하우스 하이볼", 11000, 0, false),
		rowRef("row-native", "pos-A", "생맥주", 12000, 5, false),
	}
	candidates := []RowRef{rowRef("row-elsewhere", "pos-B", "생맥주", 6000, 1, false)}

	plan, err := PlanCompletion(context.Background(), lines, onOrder, candidates, noLookup(t))
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	assertIDs(t, "CompleteRowIDs", plan.CompleteRowIDs, "row-web", "row-native")
	assertIDs(t, "MoveOutRowIDs", plan.MoveOutRowIDs)
	assertIDs(t, "AdoptRowIDs", plan.AdoptRowIDs)
	assertNatives(t, plan.Natives)
}

func TestPlanCompletion_EmptyInputs(t *testing.T) {
	plan, err := PlanCompletion(context.Background(), nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("PlanCompletion() error = %v", err)
	}
	if len(plan.CompleteRowIDs)+len(plan.MoveOutRowIDs)+len(plan.AdoptRowIDs)+len(plan.Natives) != 0 {
		t.Fatalf("PlanCompletion() = %+v, want empty plan", plan)
	}
}
