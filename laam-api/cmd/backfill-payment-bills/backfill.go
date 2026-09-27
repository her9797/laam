package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/her9797/laam/laam-api/internal/possync"
	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

// TossPlace order states (Order.orderState).
const (
	orderStateOpened    = "OPENED"
	orderStateCompleted = "COMPLETED"
	orderStateCancelled = "CANCELLED"
)

// Snapshot is what the database currently holds for one POS order — read
// before any write so dry-run can report exactly what apply would change.
type Snapshot struct {
	BillExists     bool
	BillID         string
	BillStatus     string
	TotalAmount    *int64
	DiscountAmount *int64
	Rows           []SnapshotRow
	// KnownPaymentIDs are the TossPlace payment IDs (of the ones asked
	// for) already stored in pos_payments.
	KnownPaymentIDs map[string]bool
}

// SnapshotRow is one payment_orders row on the POS order.
type SnapshotRow struct {
	ID           string
	Status       string
	BillID       string
	Amount       int64
	MenuItemName string
	CategoryName string
	// MovedOut marks a row whose item left this POS order for another
	// (pos_moved_out_at is set): it is no longer a line of this order.
	MovedOut bool
}

// Source is the read side: which POS orders to backfill and their current
// state. Nothing on it writes. Its possync.CompletionReader methods are the
// reads the completion is planned from, shared with the completed webhook.
type Source interface {
	ListPOSOrderIDsForBackfill(ctx context.Context) ([]string, error)
	LoadSnapshot(ctx context.Context, posOrderID string, paymentIDs []string) (Snapshot, error)
	possync.CompletionReader
}

// POS is the TossPlace read API the backfill needs.
type POS interface {
	GetOrder(ctx context.Context, orderID string) (tossplace.Order, error)
	GetPaymentsByOrderID(ctx context.Context, orderID string) ([]tossplace.Payment, error)
}

// Writer is the only path through which the backfill changes the
// database; *store.Repository implements it. Runner touches it only when
// Options.Apply is set, and dry-run wiring does not construct one at all.
type Writer interface {
	EnsurePOSBill(ctx context.Context, posOrderID string) (string, error)
	SetPOSBillCharge(ctx context.Context, posOrderID string, totalAmount int64, discountAmount int64) error
	CancelPOSBill(ctx context.Context, posOrderID string, orderKey string, cancelledAt time.Time) (bool, error)
	// ApplyPOSCompletion applies the same completion plan the completed
	// webhook applies, in one transaction under the POS orders' locks; it
	// skips POS-native lines already recorded, so a webhook recording them
	// concurrently cannot make them count twice.
	ApplyPOSCompletion(ctx context.Context, in store.ApplyPOSCompletionInput) (string, error)
	UpsertPOSPayments(ctx context.Context, posOrderID string, payments []store.POSPaymentInput, fullSync bool) error
	SyncPOSPayments(ctx context.Context, posOrderID string, payments []store.POSPaymentInput, expectStatus string) (bool, error)
}

type Options struct {
	Apply bool
	// Delay is waited before every TossPlace call except the first.
	Delay time.Duration
	// Limit caps how many POS orders are processed (0 = all); Offset skips
	// that many of the oldest first, so a large backfill can run in batches.
	Limit  int
	Offset int
}

type paymentTotal struct {
	Count  int
	Amount int64
}

type Failure struct {
	POSOrderID string
	Step       string
	Err        string
}

type Summary struct {
	Apply             bool
	Candidates        int
	Processed         int
	Interrupted       bool
	BillsToCreate     int
	RowsToLink        int
	RowsToDone        int
	RowsToDoneAmount  int64
	RowsToCancel      int
	RowsToCancelDone  int64
	ChargesToSet      int
	NewPayments       int
	OrdersByState     map[string]int
	PaymentsByTypeKey map[string]*paymentTotal
	Failures          []Failure

	// NativeLinesToCreate are POS line items no payment_orders row
	// represents yet (rung directly on the POS), recorded as DONE rows.
	NativeLinesToCreate       int
	NativeLinesToCreateAmount int64

	// RowsToMoveOut are unpaid rows whose item left their POS order for
	// another ("한 번에 결제"); RowsToAdopt are rows whose item moved into the
	// completed order and are paid there (also counted in RowsToDone).
	RowsToMoveOut int
	RowsToAdopt   int

	// PaymentMismatches are bills that end up PAID but whose APPROVED
	// payments are missing or do not add up to the POS charge; their
	// payment list is stored but not marked synced.
	PaymentMismatches int
}

type Runner struct {
	Source Source
	POS    POS
	Writer Writer
	Out    io.Writer
	// Sleep waits between TossPlace calls; nil uses a context-aware timer.
	Sleep func(context.Context, time.Duration) error
	// Now is the last-resort cancellation time; nil uses time.Now.
	Now func() time.Time

	apiCalls int
}

// plan is what applying one POS order changes, computed from its TossPlace
// order and payments plus the current database snapshot.
type plan struct {
	POSOrderID     string
	State          string
	Snapshot       Snapshot
	Order          tossplace.Order
	Payments       []tossplace.Payment
	CreateBill     bool
	BillStatusTo   string
	RowsToLink     int
	RowsToDone     []SnapshotRow
	RowsToCancel   []SnapshotRow
	NativeLines    []possync.NativeLine
	RowsToMoveOut  int
	RowsToAdopt    int
	Completion     possync.OrderCompletion
	ChargeChanges  bool
	NewPayments    int
	FullSync       bool
	CompletedAt    time.Time
	CancelledAt    time.Time
	CancelEstimate bool

	// PaymentMismatch is why the payments do not account for a PAID bill
	// ("" when they do); such a bill is not marked payment-synced.
	PaymentMismatch string
}

func (r *Runner) Run(ctx context.Context, opts Options) (Summary, error) {
	summary := Summary{Apply: opts.Apply, OrdersByState: map[string]int{}, PaymentsByTypeKey: map[string]*paymentTotal{}}
	if opts.Apply && r.Writer == nil {
		return summary, errors.New("apply mode requires a writer")
	}
	if opts.Limit < 0 || opts.Offset < 0 {
		return summary, errors.New("limit and offset must not be negative")
	}

	ids, err := r.Source.ListPOSOrderIDsForBackfill(ctx)
	if err != nil {
		return summary, fmt.Errorf("list POS orders: %w", err)
	}
	if opts.Offset >= len(ids) {
		ids = nil
	} else {
		ids = ids[opts.Offset:]
	}
	if opts.Limit > 0 && len(ids) > opts.Limit {
		ids = ids[:opts.Limit]
	}
	summary.Candidates = len(ids)

	mode := "DRY-RUN"
	if opts.Apply {
		mode = "APPLY"
	}
	fmt.Fprintf(r.Out, "[%s] POS 주문 %d건 처리 시작 (offset=%d limit=%d delay=%s)\n", mode, len(ids), opts.Offset, opts.Limit, opts.Delay)

	for _, posOrderID := range ids {
		if ctx.Err() != nil {
			summary.Interrupted = true
			break
		}
		p, step, err := r.planOrder(ctx, posOrderID, opts.Delay)
		if err != nil {
			if ctx.Err() != nil {
				summary.Interrupted = true
				break
			}
			r.fail(&summary, mode, posOrderID, step, err)
			continue
		}
		if opts.Apply {
			if step, err := r.apply(ctx, p); err != nil {
				r.fail(&summary, mode, posOrderID, step, err)
				continue
			}
		}
		summary.Processed++
		summary.add(p)
		fmt.Fprintf(r.Out, "[%s] %s\n", mode, p.line())
	}

	summary.print(r.Out)
	return summary, nil
}

func (r *Runner) fail(summary *Summary, mode string, posOrderID string, step string, err error) {
	summary.Failures = append(summary.Failures, Failure{POSOrderID: posOrderID, Step: step, Err: err.Error()})
	fmt.Fprintf(r.Out, "[%s] pos_order_id=%s FAILED step=%s err=%v\n", mode, posOrderID, step, err)
}

// wait paces TossPlace calls: every call but the first waits delay.
func (r *Runner) wait(ctx context.Context, delay time.Duration) error {
	r.apiCalls++
	if r.apiCalls == 1 || delay <= 0 {
		return ctx.Err()
	}
	if r.Sleep != nil {
		return r.Sleep(ctx, delay)
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (r *Runner) planOrder(ctx context.Context, posOrderID string, delay time.Duration) (plan, string, error) {
	if err := r.wait(ctx, delay); err != nil {
		return plan{}, "wait", err
	}
	order, err := r.POS.GetOrder(ctx, posOrderID)
	if err != nil {
		return plan{}, "GetOrder", err
	}
	if err := r.wait(ctx, delay); err != nil {
		return plan{}, "wait", err
	}
	payments, err := r.POS.GetPaymentsByOrderID(ctx, posOrderID)
	if err != nil {
		return plan{}, "GetPaymentsByOrderID", err
	}

	paymentIDs := make([]string, 0, len(payments))
	for _, payment := range payments {
		if strings.TrimSpace(payment.ID) == "" {
			return plan{}, "GetPaymentsByOrderID", errors.New("payment without id")
		}
		paymentIDs = append(paymentIDs, payment.ID)
	}
	snapshot, err := r.Source.LoadSnapshot(ctx, posOrderID, paymentIDs)
	if err != nil {
		return plan{}, "LoadSnapshot", err
	}

	var completion possync.OrderCompletion
	if order.OrderState == orderStateCompleted {
		completedAt, ok := completionTime(order, payments)
		if !ok {
			return plan{}, "plan", errors.New("completed order has no parseable completedAt or approved payment time")
		}
		// The completed webhook's own planner: origin orders of rows that
		// may have moved in are fetched (paced) but nothing is written.
		completion, err = possync.PlanOrderCompletion(ctx, r.Source, pacedOrders{runner: r, delay: delay}, posOrderID, order, completedAt)
		if err != nil {
			return plan{}, "PlanCompletion", err
		}
	}

	now := time.Now
	if r.Now != nil {
		now = r.Now
	}
	p, err := buildPlan(posOrderID, order, payments, snapshot, completion, now)
	if err != nil {
		return plan{}, "plan", err
	}
	return p, "", nil
}

// pacedOrders fetches origin orders for the completion planner, waiting
// between TossPlace calls like every other call the backfill makes.
type pacedOrders struct {
	runner *Runner
	delay  time.Duration
}

func (p pacedOrders) GetOrder(ctx context.Context, orderID string) (tossplace.Order, error) {
	if err := p.runner.wait(ctx, p.delay); err != nil {
		return tossplace.Order{}, err
	}
	return p.runner.POS.GetOrder(ctx, orderID)
}

// buildPlan summarizes what applying one POS order changes. For a
// completed order, completion is its plan from possync.PlanOrderCompletion.
func buildPlan(posOrderID string, order tossplace.Order, payments []tossplace.Payment, snapshot Snapshot, completion possync.OrderCompletion, now func() time.Time) (plan, error) {
	p := plan{
		POSOrderID: posOrderID,
		State:      order.OrderState,
		Snapshot:   snapshot,
		Order:      order,
		Payments:   payments,
		CreateBill: !snapshot.BillExists,
	}
	for _, row := range snapshot.Rows {
		if !row.MovedOut && (!snapshot.BillExists || row.BillID != snapshot.BillID) {
			p.RowsToLink++
		}
	}
	for _, payment := range payments {
		if !snapshot.KnownPaymentIDs[payment.ID] {
			p.NewPayments++
		}
	}
	charge := order.ChargePrice
	p.ChargeChanges = snapshot.TotalAmount == nil || *snapshot.TotalAmount != charge.TotalAmount ||
		snapshot.DiscountAmount == nil || *snapshot.DiscountAmount != charge.DiscountAmount

	currentStatus := snapshot.BillStatus
	if !snapshot.BillExists {
		currentStatus = "OPEN"
	}
	switch order.OrderState {
	case orderStateCompleted:
		completedAt, ok := completionTime(order, payments)
		if !ok {
			return plan{}, errors.New("completed order has no parseable completedAt or approved payment time")
		}
		p.CompletedAt = completedAt
		// The same plan the completed webhook applies (possync): rows
		// already DONE count as matched lines, so a re-run finds nothing new.
		p.Completion = completion
		p.NativeLines = completion.Plan.Natives
		settled := map[string]bool{}
		for _, id := range completion.Plan.CompleteRowIDs {
			settled[id] = true
		}
		hasCancelled := false
		for _, row := range snapshot.Rows {
			switch {
			case row.MovedOut:
			case row.Status == "CANCELLED":
				hasCancelled = true
			case settled[row.ID] && isUnpaid(row.Status):
				p.RowsToDone = append(p.RowsToDone, row)
			}
		}
		for _, id := range completion.Plan.MoveOutRowIDs {
			if isUnpaid(completion.Rows[id].Status) {
				p.RowsToMoveOut++
			}
		}
		for _, id := range completion.Plan.AdoptRowIDs {
			row := completion.Rows[id]
			p.RowsToAdopt++
			p.RowsToDone = append(p.RowsToDone, SnapshotRow{ID: row.ID, Status: row.Status, Amount: row.Amount, MenuItemName: row.MenuItemName, CategoryName: row.CategoryName})
		}
		// Mirrors ApplyPOSCompletion: a bill whose remaining rows are all
		// cancelled is CANCELLED, otherwise PAID.
		live := len(p.NativeLines) + len(completion.Plan.CompleteRowIDs) + len(completion.Plan.AdoptRowIDs)
		p.BillStatusTo = "PAID"
		if currentStatus == "CANCELLED" || (live == 0 && hasCancelled) {
			p.BillStatusTo = "CANCELLED"
		}
		// Same check as the webhook's payment sync: a PAID bill whose
		// payments do not add up stays unsynced for the retry claim.
		p.PaymentMismatch = possync.PaymentMismatch(p.BillStatusTo, charge.TotalAmount, payments)
		p.FullSync = p.PaymentMismatch == ""
	case orderStateCancelled:
		p.CancelledAt, p.CancelEstimate = cancellationTime(order, payments, now)
		for _, row := range snapshot.Rows {
			if row.MovedOut {
				// CancelPOSBill leaves it: its item lives on another order.
				continue
			}
			switch row.Status {
			case "READY", "ACKNOWLEDGED", "DONE":
				p.RowsToCancel = append(p.RowsToCancel, row)
			}
		}
		p.BillStatusTo = "CANCELLED"
		p.FullSync = true
	case orderStateOpened:
		// Still open at the POS: link the rows and record whatever
		// payments exist, but do not mark the payment list complete —
		// the order.completed webhook and payment-sync retry own that.
		p.BillStatusTo = currentStatus
	default:
		return plan{}, fmt.Errorf("unknown orderState %q", order.OrderState)
	}
	return p, nil
}

// apply performs the plan's writes. Every call is idempotent, so a partial
// failure is fixed by re-running.
func (r *Runner) apply(ctx context.Context, p plan) (string, error) {
	if p.State == orderStateCompleted {
		// One transaction: bill, charge, completed/moved/adopted rows and
		// POS-native lines (natives a webhook recorded since the plan was
		// made are not added again).
		if _, err := r.Writer.ApplyPOSCompletion(ctx, p.Completion.Input); err != nil {
			return "ApplyPOSCompletion", err
		}
	} else {
		if _, err := r.Writer.EnsurePOSBill(ctx, p.POSOrderID); err != nil {
			return "EnsurePOSBill", err
		}
		if err := r.Writer.SetPOSBillCharge(ctx, p.POSOrderID, p.Order.ChargePrice.TotalAmount, p.Order.ChargePrice.DiscountAmount); err != nil {
			return "SetPOSBillCharge", err
		}
	}
	if p.State == orderStateCancelled {
		if _, err := r.Writer.CancelPOSBill(ctx, p.POSOrderID, "", p.CancelledAt); err != nil {
			return "CancelPOSBill", err
		}
	}
	inputs := make([]store.POSPaymentInput, 0, len(p.Payments))
	for _, payment := range p.Payments {
		inputs = append(inputs, paymentInput(payment))
	}
	if p.FullSync {
		// Marked synced only if no order event changed the bill's status
		// since the payment list was fetched.
		if _, err := r.Writer.SyncPOSPayments(ctx, p.POSOrderID, inputs, p.BillStatusTo); err != nil {
			return "SyncPOSPayments", err
		}
		return "", nil
	}
	if err := r.Writer.UpsertPOSPayments(ctx, p.POSOrderID, inputs, false); err != nil {
		return "UpsertPOSPayments", err
	}
	return "", nil
}

// paymentInput keeps only what pos_payments stores: no card or account
// numbers (tossplace.Payment does not decode them either). A payment
// without approvedAt falls back to its createdAt, as the webhook does.
func paymentInput(payment tossplace.Payment) store.POSPaymentInput {
	approvedAt, ok := parseTossTime(payment.ApprovedAt)
	if !ok {
		approvedAt, _ = parseTossTime(payment.CreatedAt)
	}
	cancelledAt, _ := parseTossTime(payment.CancelledAt)
	return store.POSPaymentInput{
		ID:              payment.ID,
		State:           payment.State,
		SourceType:      payment.SourceType,
		PaymentMethod:   payment.PaymentMethod,
		CardBrand:       payment.CardDetails.CardBrand,
		Amount:          payment.Amount,
		TaxAmount:       payment.TaxAmount,
		SupplyAmount:    payment.SupplyAmount,
		TaxExemptAmount: payment.TaxExemptAmount,
		ApprovedNo:      payment.ApprovedNo,
		ApprovedAt:      approvedAt,
		CancelledAt:     cancelledAt,
	}
}

// tossTimeWithoutZone is the timezone-less layout TossPlace's docs show.
const tossTimeWithoutZone = "2006-01-02T15:04:05"

func parseTossTime(raw string) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, false
	}
	if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		return parsed, true
	}
	if parsed, err := time.Parse(tossTimeWithoutZone, raw); err == nil {
		return parsed.UTC(), true
	}
	return time.Time{}, false
}

// completionTime is the order's completedAt, else its latest approved
// payment time. Unlike the webhook it never falls back to now: a backfill
// stamping today's date on months-old sales would misplace revenue.
func completionTime(order tossplace.Order, payments []tossplace.Payment) (time.Time, bool) {
	if completedAt, ok := parseTossTime(order.CompletedAt); ok {
		return completedAt, true
	}
	var latest time.Time
	for _, payment := range payments {
		if payment.State != "APPROVED" {
			continue
		}
		if approvedAt, ok := parseTossTime(payment.ApprovedAt); ok && approvedAt.After(latest) {
			latest = approvedAt
		}
	}
	return latest, !latest.IsZero()
}

// cancellationTime is the order's cancelledAt, else the latest payment
// cancellation, else completedAt, else now (estimated).
func cancellationTime(order tossplace.Order, payments []tossplace.Payment, now func() time.Time) (time.Time, bool) {
	if cancelledAt, ok := parseTossTime(order.CancelledAt); ok {
		return cancelledAt, false
	}
	var latest time.Time
	for _, payment := range payments {
		if cancelledAt, ok := parseTossTime(payment.CancelledAt); ok && cancelledAt.After(latest) {
			latest = cancelledAt
		}
	}
	if !latest.IsZero() {
		return latest, false
	}
	if completedAt, ok := parseTossTime(order.CompletedAt); ok {
		return completedAt, false
	}
	return now().UTC(), true
}

func isUnpaid(status string) bool {
	return status == "READY" || status == "ACKNOWLEDGED"
}

func sumAmount(rows []SnapshotRow, statuses ...string) int64 {
	var total int64
	for _, row := range rows {
		for _, status := range statuses {
			if row.Status == status {
				total += row.Amount
				break
			}
		}
	}
	return total
}

func nativeAmount(lines []possync.NativeLine) int64 {
	var total int64
	for _, line := range lines {
		total += line.Amount
	}
	return total
}

func paymentKey(payment tossplace.Payment) string {
	sourceType := payment.SourceType
	if sourceType == "" {
		sourceType = "UNKNOWN"
	}
	state := payment.State
	if state == "" {
		state = "UNKNOWN"
	}
	return sourceType + "/" + state
}

// line is the per-bill report. It prints IDs, states and amounts only —
// never approval numbers, card data or anything from the request headers.
func (p plan) line() string {
	billAction := "exists"
	if p.CreateBill {
		billAction = "create"
	}
	from := p.Snapshot.BillStatus
	if !p.Snapshot.BillExists {
		from = "none"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "pos_order_id=%s state=%s bill=%s(%s->%s) rows=%d link=%d done+=%d(%d) cancel=%d(done %d) charge=%d discount=%d",
		p.POSOrderID, p.State, billAction, from, p.BillStatusTo, len(p.Snapshot.Rows), p.RowsToLink,
		len(p.RowsToDone), sumAmount(p.RowsToDone, "READY", "ACKNOWLEDGED"),
		len(p.RowsToCancel), sumAmount(p.RowsToCancel, "DONE"),
		p.Order.ChargePrice.TotalAmount, p.Order.ChargePrice.DiscountAmount)
	if p.State == orderStateCompleted {
		fmt.Fprintf(&b, " completed_at=%s native_lines_to_create=%d(%d) moved_out=%d adopted=%d natives=%d",
			p.CompletedAt.UTC().Format(time.RFC3339), len(p.NativeLines), nativeAmount(p.NativeLines),
			p.RowsToMoveOut, p.RowsToAdopt, len(p.NativeLines))
	}
	if p.State == orderStateCancelled {
		estimated := ""
		if p.CancelEstimate {
			estimated = "(now,estimated)"
		}
		fmt.Fprintf(&b, " cancelled_at=%s%s", p.CancelledAt.UTC().Format(time.RFC3339), estimated)
	}
	fmt.Fprintf(&b, " payments=%d new=%d", len(p.Payments), p.NewPayments)
	if p.PaymentMismatch != "" {
		fmt.Fprintf(&b, " payment_mismatch=(%s)", p.PaymentMismatch)
	}
	for _, payment := range p.Payments {
		fmt.Fprintf(&b, " %s:%d", paymentKey(payment), payment.Amount)
	}
	return b.String()
}

func (s *Summary) add(p plan) {
	s.OrdersByState[p.State]++
	if p.CreateBill {
		s.BillsToCreate++
	}
	s.RowsToLink += p.RowsToLink
	s.RowsToDone += len(p.RowsToDone)
	s.RowsToDoneAmount += sumAmount(p.RowsToDone, "READY", "ACKNOWLEDGED")
	s.RowsToCancel += len(p.RowsToCancel)
	s.RowsToCancelDone += sumAmount(p.RowsToCancel, "DONE")
	s.NativeLinesToCreate += len(p.NativeLines)
	s.NativeLinesToCreateAmount += nativeAmount(p.NativeLines)
	s.RowsToMoveOut += p.RowsToMoveOut
	s.RowsToAdopt += p.RowsToAdopt
	if p.ChargeChanges {
		s.ChargesToSet++
	}
	s.NewPayments += p.NewPayments
	if p.PaymentMismatch != "" {
		s.PaymentMismatches++
	}
	for _, payment := range p.Payments {
		key := paymentKey(payment)
		if s.PaymentsByTypeKey[key] == nil {
			s.PaymentsByTypeKey[key] = &paymentTotal{}
		}
		s.PaymentsByTypeKey[key].Count++
		s.PaymentsByTypeKey[key].Amount += payment.Amount
	}
}

func (s Summary) print(out io.Writer) {
	mode := "DRY-RUN (쓰기 없음, --apply로 실제 반영)"
	if s.Apply {
		mode = "APPLY"
	}
	fmt.Fprintf(out, "== 요약: %s ==\n", mode)
	if s.Interrupted {
		fmt.Fprintln(out, "interrupted=true (중단됨: 남은 주문은 처리하지 않음)")
	}
	fmt.Fprintf(out, "candidates=%d processed=%d\n", s.Candidates, s.Processed)
	states := make([]string, 0, len(s.OrdersByState))
	for state := range s.OrdersByState {
		states = append(states, state)
	}
	sort.Strings(states)
	for _, state := range states {
		fmt.Fprintf(out, "order_state %s=%d\n", state, s.OrdersByState[state])
	}
	fmt.Fprintf(out, "bills_to_create=%d rows_to_link=%d charges_to_set=%d\n", s.BillsToCreate, s.RowsToLink, s.ChargesToSet)
	fmt.Fprintf(out, "rows_to_done=%d amount=%d (READY/ACKNOWLEDGED->DONE, 기존 메뉴 합산 기준 매출 증가분)\n", s.RowsToDone, s.RowsToDoneAmount)
	fmt.Fprintf(out, "rows_to_cancelled=%d done_amount=%d (->CANCELLED, 그중 DONE 행 금액 = 매출 감소분)\n", s.RowsToCancel, s.RowsToCancelDone)
	fmt.Fprintf(out, "native_lines_to_create=%d amount=%d (POS 직접 입력 메뉴 -> DONE 행 추가 = 매출 증가분)\n", s.NativeLinesToCreate, s.NativeLinesToCreateAmount)
	fmt.Fprintf(out, "rows_moved_out=%d rows_adopted=%d (POS '한 번에 결제'로 다른 POS 주문으로 옮겨진 메뉴: 원래 계산서에서 빠지고, 결제된 주문의 계산서에서 DONE)\n", s.RowsToMoveOut, s.RowsToAdopt)
	fmt.Fprintf(out, "new_payments=%d\n", s.NewPayments)
	fmt.Fprintf(out, "payment_mismatch=%d (PAID인데 APPROVED 결제가 없거나 합계가 POS 청구액과 달라 결제 동기화 완료로 표시하지 않음)\n", s.PaymentMismatches)
	keys := make([]string, 0, len(s.PaymentsByTypeKey))
	for key := range s.PaymentsByTypeKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		fmt.Fprintf(out, "payments %s count=%d amount=%d\n", key, s.PaymentsByTypeKey[key].Count, s.PaymentsByTypeKey[key].Amount)
	}
	fmt.Fprintf(out, "failures=%d\n", len(s.Failures))
	for _, failure := range s.Failures {
		fmt.Fprintf(out, "  failure pos_order_id=%s step=%s err=%s\n", failure.POSOrderID, failure.Step, failure.Err)
	}
}
