package store

import (
	"context"
	"errors"
	"sort"
	"sync"
	"testing"
	"time"
)

// TossPlace's "한 번에 결제" can move a line item from one POS order to
// another at payment time. These tests cover the storage side: a web row
// seeded on POS order X that ends up paid inside POS order Y.

var moveBase = time.Date(2026, 9, 20, 20, 0, 0, 0, time.UTC)

func seedMoveRow(t *testing.T, ctx context.Context, id, posOrderID, name string, amount int64, status string, createdAt time.Time) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, pos_order_id, created_at
		) VALUES ($1, $2, '위스키', 'T-01', $3, $4, 'SUCCEEDED', NULLIF($5, ''), $6)
	`, id, name, amount, status, posOrderID, createdAt); err != nil {
		t.Fatalf("seed payment_orders %q: %v", id, err)
	}
}

type moveRowState struct {
	Status     string
	POSOrderID string
	BillID     string
	Origin     string
	MovedOut   bool
	Method     string
	ApprovedAt *time.Time
	VAT        int64
	Supplied   int64
}

func readMoveRow(t *testing.T, ctx context.Context, id string) moveRowState {
	t.Helper()
	var s moveRowState
	if err := testPool.QueryRow(ctx, `
		SELECT status, COALESCE(pos_order_id, ''), COALESCE(bill_id, ''), COALESCE(pos_origin_order_id, ''),
			pos_moved_out_at IS NOT NULL, COALESCE(payment_method, ''), approved_at, vat, supplied_amount
		FROM payment_orders WHERE id = $1
	`, id).Scan(&s.Status, &s.POSOrderID, &s.BillID, &s.Origin, &s.MovedOut, &s.Method, &s.ApprovedAt, &s.VAT, &s.Supplied); err != nil {
		t.Fatalf("read payment_orders %q: %v", id, err)
	}
	return s
}

// billLines returns "name/status" for every row linked to the bill of posOrderID, sorted.
func billLines(t *testing.T, ctx context.Context, posOrderID string) []string {
	t.Helper()
	rows, err := testPool.Query(ctx, `
		SELECT o.menu_item_name || '/' || o.status
		FROM payment_orders o JOIN pos_bills b ON b.id = o.bill_id
		WHERE b.pos_order_id = $1
	`, posOrderID)
	if err != nil {
		t.Fatalf("query bill lines %q: %v", posOrderID, err)
	}
	defer rows.Close()
	lines := make([]string, 0)
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan bill line: %v", err)
		}
		lines = append(lines, line)
	}
	sort.Strings(lines)
	return lines
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func int64Ptr(v int64) *int64 { return &v }

// seedJamesonCase: web 제임슨 was ordered on POS order X, web 하이볼 on POS
// order Y (another table). At the POS, 제임슨 was paid together with Y.
func seedJamesonCase(t *testing.T, ctx context.Context) (billX, billY string) {
	t.Helper()
	resetPaymentOrdersTable(t, ctx)
	seedMoveRow(t, ctx, "w-jameson", "pos-x", "제임슨", 12000, "READY", moveBase)
	seedMoveRow(t, ctx, "w-highball", "pos-y", "하이볼", 9000, "ACKNOWLEDGED", moveBase.Add(5*time.Minute))
	var err error
	if billX, err = testRepo.EnsurePOSBill(ctx, "pos-x"); err != nil {
		t.Fatalf("EnsurePOSBill(pos-x) error = %v", err)
	}
	if billY, err = testRepo.EnsurePOSBill(ctx, "pos-y"); err != nil {
		t.Fatalf("EnsurePOSBill(pos-y) error = %v", err)
	}
	return billX, billY
}

func jamesonXInput() ApplyPOSCompletionInput {
	return ApplyPOSCompletionInput{
		POSOrderID:    "pos-x",
		CompletedAt:   moveBase.Add(time.Hour),
		MoveOutRowIDs: []string{"w-jameson"},
		Natives: []CreatePOSNativeOrderInput{{
			MenuItemName: "고독", CategoryName: "칵테일", Amount: 9000,
			ApprovedAt: moveBase.Add(time.Hour), VAT: 818, SuppliedAmount: 8182, OrderedAt: moveBase.Add(10 * time.Minute),
		}},
		TotalAmount:    int64Ptr(9000),
		DiscountAmount: int64Ptr(0),
	}
}

func jamesonYInput() ApplyPOSCompletionInput {
	return ApplyPOSCompletionInput{
		POSOrderID:     "pos-y",
		CompletedAt:    moveBase.Add(2 * time.Hour),
		CompleteRowIDs: []string{"w-highball"},
		AdoptRowIDs:    []string{"w-jameson"},
		Natives: []CreatePOSNativeOrderInput{{
			MenuItemName: "조니워커", CategoryName: "위스키", Amount: 15000,
			ApprovedAt: moveBase.Add(2 * time.Hour), VAT: 1363, SuppliedAmount: 13637, OrderedAt: moveBase.Add(6 * time.Minute),
		}},
		TotalAmount:    int64Ptr(36000),
		DiscountAmount: int64Ptr(0),
	}
}

func assertJamesonFinal(t *testing.T, ctx context.Context, billX, billY string) {
	t.Helper()
	jameson := readMoveRow(t, ctx, "w-jameson")
	if jameson.Status != "DONE" || jameson.POSOrderID != "pos-y" || jameson.BillID != billY ||
		jameson.Origin != "pos-x" || jameson.MovedOut || jameson.Method != "POS" {
		t.Fatalf("제임슨 = %+v, want DONE on pos-y/%s origin pos-x, not moved out, POS", jameson, billY)
	}
	if jameson.ApprovedAt == nil || !jameson.ApprovedAt.Equal(moveBase.Add(2*time.Hour)) || jameson.VAT != 1090 || jameson.Supplied != 10910 {
		t.Fatalf("제임슨 approved/vat/supplied = %v/%d/%d, want Y completion/1090/10910", jameson.ApprovedAt, jameson.VAT, jameson.Supplied)
	}
	if got, want := billLines(t, ctx, "pos-x"), []string{"고독/DONE"}; !equalStrings(got, want) {
		t.Fatalf("bill X lines = %v, want %v", got, want)
	}
	if got, want := billLines(t, ctx, "pos-y"), []string{"제임슨/DONE", "조니워커/DONE", "하이볼/DONE"}; !equalStrings(got, want) {
		t.Fatalf("bill Y lines = %v, want %v", got, want)
	}
	for posOrderID, want := range map[string]int64{"pos-x": 9000, "pos-y": 36000} {
		id, status, _, _ := queryBill(t, ctx, posOrderID)
		var total, discount *int64
		var completedAt *time.Time
		if err := testPool.QueryRow(ctx, `SELECT total_amount, discount_amount, completed_at FROM pos_bills WHERE id = $1`, id).Scan(&total, &discount, &completedAt); err != nil {
			t.Fatalf("read bill %s: %v", posOrderID, err)
		}
		if status != "PAID" || total == nil || *total != want || discount == nil || *discount != 0 || completedAt == nil {
			t.Fatalf("bill %s = %s total=%v discount=%v completed=%v, want PAID/%d/0/set", posOrderID, status, total, discount, completedAt, want)
		}
	}
	if billX == billY {
		t.Fatalf("bills X and Y share id %q", billX)
	}

	onX, err := testRepo.ListPOSRowsOnOrder(ctx, "pos-x")
	if err != nil {
		t.Fatalf("ListPOSRowsOnOrder(pos-x) error = %v", err)
	}
	if len(onX) != 1 || onX[0].MenuItemName != "고독" || onX[0].Status != "DONE" || onX[0].POSOrderID != "pos-x" {
		t.Fatalf("rows on pos-x = %+v, want only 고독", onX)
	}
	onY, err := testRepo.ListPOSRowsOnOrder(ctx, "pos-y")
	if err != nil {
		t.Fatalf("ListPOSRowsOnOrder(pos-y) error = %v", err)
	}
	if len(onY) != 3 || onY[0].ID != "w-jameson" || onY[1].ID != "w-highball" || onY[2].MenuItemName != "조니워커" {
		t.Fatalf("rows on pos-y = %+v, want 제임슨, 하이볼, 조니워커 oldest first", onY)
	}
}

func TestRepository_ApplyPOSCompletion_MovedItem_XCompletesFirst(t *testing.T) {
	ctx := context.Background()
	billX, billY := seedJamesonCase(t, ctx)

	gotX, err := testRepo.ApplyPOSCompletion(ctx, jamesonXInput())
	if err != nil {
		t.Fatalf("ApplyPOSCompletion(X) error = %v", err)
	}
	if gotX != billX {
		t.Fatalf("ApplyPOSCompletion(X) bill = %q, want %q", gotX, billX)
	}

	// Between the two completions 제임슨 is still unpaid, on X, off X's bill.
	jameson := readMoveRow(t, ctx, "w-jameson")
	if jameson.Status != "READY" || jameson.POSOrderID != "pos-x" || jameson.BillID != "" || !jameson.MovedOut {
		t.Fatalf("제임슨 after X = %+v, want READY on pos-x, no bill, moved out", jameson)
	}
	rows, err := testRepo.ListPOSRowsOnOrder(ctx, "pos-x")
	if err != nil {
		t.Fatalf("ListPOSRowsOnOrder() error = %v", err)
	}
	if len(rows) != 2 || rows[0].ID != "w-jameson" || rows[0].MovedOutAt.IsZero() || rows[1].MenuItemName != "고독" || !rows[1].MovedOutAt.IsZero() {
		t.Fatalf("rows on pos-x = %+v, want moved-out 제임슨 then 고독", rows)
	}
	lines, err := testRepo.ListPOSOrderLines(ctx, "pos-x")
	if err != nil {
		t.Fatalf("ListPOSOrderLines() error = %v", err)
	}
	if len(lines) != 1 || lines[0].MenuItemName != "고독" {
		t.Fatalf("ListPOSOrderLines(pos-x) = %+v, want only 고독 (moved-out rows excluded)", lines)
	}
	// A later ensure (e.g. a payment event for X) must not relink the moved-out row.
	if _, err := testRepo.EnsurePOSBill(ctx, "pos-x"); err != nil {
		t.Fatalf("EnsurePOSBill() error = %v", err)
	}
	if got := readMoveRow(t, ctx, "w-jameson"); got.BillID != "" {
		t.Fatalf("제임슨 bill_id after EnsurePOSBill = %q, want none", got.BillID)
	}

	gotY, err := testRepo.ApplyPOSCompletion(ctx, jamesonYInput())
	if err != nil {
		t.Fatalf("ApplyPOSCompletion(Y) error = %v", err)
	}
	if gotY != billY {
		t.Fatalf("ApplyPOSCompletion(Y) bill = %q, want %q", gotY, billY)
	}
	assertJamesonFinal(t, ctx, billX, billY)
}

func TestRepository_ApplyPOSCompletion_MovedItem_YCompletesFirst(t *testing.T) {
	ctx := context.Background()
	billX, billY := seedJamesonCase(t, ctx)

	if _, err := testRepo.ApplyPOSCompletion(ctx, jamesonYInput()); err != nil {
		t.Fatalf("ApplyPOSCompletion(Y) error = %v", err)
	}
	// X's plan still names 제임슨 as moved out, but it already lives on Y.
	if _, err := testRepo.ApplyPOSCompletion(ctx, jamesonXInput()); err != nil {
		t.Fatalf("ApplyPOSCompletion(X) error = %v", err)
	}
	assertJamesonFinal(t, ctx, billX, billY)
}

func TestRepository_ApplyPOSCompletion_IsIdempotent(t *testing.T) {
	ctx := context.Background()
	billX, billY := seedJamesonCase(t, ctx)

	for i := 0; i < 2; i++ {
		if _, err := testRepo.ApplyPOSCompletion(ctx, jamesonXInput()); err != nil {
			t.Fatalf("ApplyPOSCompletion(X) #%d error = %v", i, err)
		}
		if _, err := testRepo.ApplyPOSCompletion(ctx, jamesonYInput()); err != nil {
			t.Fatalf("ApplyPOSCompletion(Y) #%d error = %v", i, err)
		}
	}
	assertJamesonFinal(t, ctx, billX, billY)
	var count int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM payment_orders`).Scan(&count); err != nil {
		t.Fatalf("count payment_orders: %v", err)
	}
	if count != 4 {
		t.Fatalf("payment_orders count = %d, want 4 (no duplicated natives)", count)
	}
}

func TestRepository_ApplyPOSCompletion_NeverResurrectsCancelledRows(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedMoveRow(t, ctx, "w-cancelled-here", "pos-y", "하이볼", 9000, "CANCELLED", moveBase)
	seedMoveRow(t, ctx, "w-cancelled-there", "pos-x", "제임슨", 12000, "CANCELLED", moveBase)
	seedMoveRow(t, ctx, "w-live", "pos-y", "조니워커", 15000, "READY", moveBase)

	billY, err := testRepo.ApplyPOSCompletion(ctx, ApplyPOSCompletionInput{
		POSOrderID:     "pos-y",
		CompletedAt:    moveBase.Add(time.Hour),
		CompleteRowIDs: []string{"w-cancelled-here", "w-live"},
		MoveOutRowIDs:  []string{"w-cancelled-here"},
		AdoptRowIDs:    []string{"w-cancelled-there"},
	})
	if err != nil {
		t.Fatalf("ApplyPOSCompletion() error = %v", err)
	}
	if got := readMoveRow(t, ctx, "w-cancelled-here"); got.Status != "CANCELLED" || got.MovedOut {
		t.Fatalf("cancelled row on Y = %+v, want CANCELLED, not moved out", got)
	}
	if got := readMoveRow(t, ctx, "w-cancelled-there"); got.Status != "CANCELLED" || got.POSOrderID != "pos-x" || got.BillID == billY {
		t.Fatalf("cancelled row on X = %+v, want CANCELLED and left on pos-x", got)
	}
	if got := readMoveRow(t, ctx, "w-live"); got.Status != "DONE" || got.BillID != billY {
		t.Fatalf("live row = %+v, want DONE on %s", got, billY)
	}
}

func TestRepository_ApplyPOSCompletion_SkipsAdoptingRowPaidElsewhere(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedMoveRow(t, ctx, "w-jameson", "pos-x", "제임슨", 12000, "READY", moveBase)
	billX, _, err := testRepo.CompletePOSBill(ctx, CompletePOSBillInput{POSOrderID: "pos-x", CompletedAt: moveBase.Add(time.Hour)})
	if err != nil {
		t.Fatalf("CompletePOSBill(X) error = %v", err)
	}

	billY, err := testRepo.ApplyPOSCompletion(ctx, ApplyPOSCompletionInput{
		POSOrderID:  "pos-y",
		CompletedAt: moveBase.Add(2 * time.Hour),
		AdoptRowIDs: []string{"w-jameson"},
	})
	if err != nil {
		t.Fatalf("ApplyPOSCompletion(Y) error = %v", err)
	}
	got := readMoveRow(t, ctx, "w-jameson")
	if got.Status != "DONE" || got.POSOrderID != "pos-x" || got.BillID != billX || got.Origin != "" ||
		got.ApprovedAt == nil || !got.ApprovedAt.Equal(moveBase.Add(time.Hour)) {
		t.Fatalf("제임슨 = %+v, want untouched DONE on pos-x/%s", got, billX)
	}
	if billY == "" || billY == billX {
		t.Fatalf("bill Y = %q, want its own bill", billY)
	}
}

func TestRepository_CancelPOSBill_LeavesMovedOutRowsAlone(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedMoveRow(t, ctx, "w-jameson", "pos-x", "제임슨", 12000, "READY", moveBase)
	seedMoveRow(t, ctx, "w-godok", "pos-x", "고독", 9000, "READY", moveBase.Add(time.Minute))
	if _, err := testRepo.ApplyPOSCompletion(ctx, ApplyPOSCompletionInput{
		POSOrderID:     "pos-x",
		CompletedAt:    moveBase.Add(time.Hour),
		CompleteRowIDs: []string{"w-godok"},
		MoveOutRowIDs:  []string{"w-jameson"},
	}); err != nil {
		t.Fatalf("ApplyPOSCompletion(X) error = %v", err)
	}

	found, err := testRepo.CancelPOSBill(ctx, "pos-x", "", moveBase.Add(3*time.Hour))
	if err != nil || !found {
		t.Fatalf("CancelPOSBill() = %v/%v, want found", found, err)
	}
	if got := readMoveRow(t, ctx, "w-jameson"); got.Status != "READY" || got.BillID != "" || !got.MovedOut {
		t.Fatalf("moved-out 제임슨 = %+v, want READY, no bill, still moved out", got)
	}
	if got := readMoveRow(t, ctx, "w-godok"); got.Status != "CANCELLED" {
		t.Fatalf("고독 status = %q, want CANCELLED", got.Status)
	}
}

func TestRepository_ApplyPOSCompletion_ConcurrentCrossMovesDoNotDeadlock(t *testing.T) {
	ctx := context.Background()
	for round := 0; round < 15; round++ {
		resetPaymentOrdersTable(t, ctx)
		// a was ordered on X but paid in Y; b was ordered on Y but paid in X.
		seedMoveRow(t, ctx, "w-a", "pos-x", "제임슨", 12000, "READY", moveBase)
		seedMoveRow(t, ctx, "w-b", "pos-y", "조니워커", 15000, "READY", moveBase.Add(time.Minute))
		seedMoveRow(t, ctx, "w-x", "pos-x", "고독", 9000, "READY", moveBase.Add(2*time.Minute))
		seedMoveRow(t, ctx, "w-y", "pos-y", "하이볼", 8000, "READY", moveBase.Add(3*time.Minute))

		inputs := []ApplyPOSCompletionInput{
			{POSOrderID: "pos-x", CompletedAt: moveBase.Add(time.Hour), CompleteRowIDs: []string{"w-x"}, MoveOutRowIDs: []string{"w-a"}, AdoptRowIDs: []string{"w-b"},
				Natives: []CreatePOSNativeOrderInput{{MenuItemName: "안주", CategoryName: "안주", Amount: 5000, ApprovedAt: moveBase.Add(time.Hour), VAT: 454, SuppliedAmount: 4546}}},
			{POSOrderID: "pos-y", CompletedAt: moveBase.Add(time.Hour), CompleteRowIDs: []string{"w-y"}, MoveOutRowIDs: []string{"w-b"}, AdoptRowIDs: []string{"w-a"}},
		}
		runCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		var wg sync.WaitGroup
		errs := make([]error, 0)
		var mu sync.Mutex
		start := make(chan struct{})
		for i := 0; i < 3; i++ { // duplicate deliveries of both completions
			for _, input := range inputs {
				wg.Add(1)
				go func(in ApplyPOSCompletionInput) {
					defer wg.Done()
					<-start
					if _, err := testRepo.ApplyPOSCompletion(runCtx, in); err != nil {
						mu.Lock()
						errs = append(errs, err)
						mu.Unlock()
					}
				}(input)
			}
		}
		close(start)
		wg.Wait()
		cancel()
		if len(errs) > 0 {
			t.Fatalf("round %d: concurrent ApplyPOSCompletion errors = %v", round, errors.Join(errs...))
		}

		if got := readMoveRow(t, ctx, "w-a"); got.Status != "DONE" || got.POSOrderID != "pos-y" || got.Origin != "pos-x" || got.MovedOut {
			t.Fatalf("round %d: a = %+v, want DONE on pos-y", round, got)
		}
		if got := readMoveRow(t, ctx, "w-b"); got.Status != "DONE" || got.POSOrderID != "pos-x" || got.Origin != "pos-y" || got.MovedOut {
			t.Fatalf("round %d: b = %+v, want DONE on pos-x", round, got)
		}
		if got, want := billLines(t, ctx, "pos-x"), []string{"고독/DONE", "안주/DONE", "조니워커/DONE"}; !equalStrings(got, want) {
			t.Fatalf("round %d: bill X lines = %v, want %v", round, got, want)
		}
		if got, want := billLines(t, ctx, "pos-y"), []string{"제임슨/DONE", "하이볼/DONE"}; !equalStrings(got, want) {
			t.Fatalf("round %d: bill Y lines = %v, want %v", round, got, want)
		}
	}
}

func TestRepository_ApplyPOSCompletion_LeavesChargeWhenUnknown(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	seedMoveRow(t, ctx, "w-1", "pos-x", "제임슨", 12000, "READY", moveBase)
	if _, err := testRepo.EnsurePOSBill(ctx, "pos-x"); err != nil {
		t.Fatalf("EnsurePOSBill() error = %v", err)
	}
	if err := testRepo.SetPOSBillCharge(ctx, "pos-x", 11000, 1000); err != nil {
		t.Fatalf("SetPOSBillCharge() error = %v", err)
	}
	if _, err := testRepo.ApplyPOSCompletion(ctx, ApplyPOSCompletionInput{POSOrderID: "pos-x", CompletedAt: moveBase, CompleteRowIDs: []string{"w-1"}}); err != nil {
		t.Fatalf("ApplyPOSCompletion() error = %v", err)
	}
	var total, discount int64
	if err := testPool.QueryRow(ctx, `SELECT total_amount, discount_amount FROM pos_bills WHERE pos_order_id = 'pos-x'`).Scan(&total, &discount); err != nil {
		t.Fatalf("read bill: %v", err)
	}
	if total != 11000 || discount != 1000 {
		t.Fatalf("charge = %d/%d, want 11000/1000 kept", total, discount)
	}
	if _, err := testRepo.ApplyPOSCompletion(ctx, ApplyPOSCompletionInput{POSOrderID: ""}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("ApplyPOSCompletion(empty) error = %v, want ErrInvalidInput", err)
	}
}

func TestRepository_ListPOSMoveCandidates_FiltersByStatusOrderAndWindow(t *testing.T) {
	ctx := context.Background()
	resetPaymentOrdersTable(t, ctx)
	from, to := moveBase, moveBase.Add(time.Hour)
	seedMoveRow(t, ctx, "c-ready-late", "pos-x", "제임슨", 12000, "READY", from.Add(30*time.Minute))
	seedMoveRow(t, ctx, "c-ack", "pos-z", "하이볼", 9000, "ACKNOWLEDGED", from.Add(10*time.Minute))
	seedMoveRow(t, ctx, "c-at-from", "pos-x", "고독", 9000, "READY", from)
	seedMoveRow(t, ctx, "n-at-to", "pos-x", "고독", 9000, "READY", to)
	seedMoveRow(t, ctx, "n-before", "pos-x", "고독", 9000, "READY", from.Add(-time.Second))
	seedMoveRow(t, ctx, "n-done", "pos-x", "고독", 9000, "DONE", from.Add(time.Minute))
	seedMoveRow(t, ctx, "n-cancelled", "pos-x", "고독", 9000, "CANCELLED", from.Add(time.Minute))
	seedMoveRow(t, ctx, "n-same-order", "pos-y", "고독", 9000, "READY", from.Add(time.Minute))
	seedMoveRow(t, ctx, "n-no-pos", "", "고독", 9000, "READY", from.Add(time.Minute))

	got, err := testRepo.ListPOSMoveCandidates(ctx, "pos-y", from, to)
	if err != nil {
		t.Fatalf("ListPOSMoveCandidates() error = %v", err)
	}
	ids := make([]string, 0, len(got))
	for _, row := range got {
		ids = append(ids, row.ID)
	}
	if want := []string{"c-at-from", "c-ack", "c-ready-late"}; !equalStrings(ids, want) {
		t.Fatalf("candidates = %v, want %v", ids, want)
	}
	first := got[0]
	if first.POSOrderID != "pos-x" || first.MenuItemName != "고독" || first.CategoryName != "위스키" || first.Status != "READY" ||
		first.Amount != 9000 || !first.CreatedAt.Equal(from) || !first.MovedOutAt.IsZero() {
		t.Fatalf("candidate = %+v, want full row of c-at-from", first)
	}
}
