package possync

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

// TossPlace order/payment states and pos_bills statuses this package acts on.
const (
	orderStateCancelled  = "CANCELLED"
	paymentStateApproved = "APPROVED"
	billStatusPaid       = "PAID"
	billStatusOpen       = "OPEN"
)

// Syncer applies TossPlace order/payment state to the store. Every method
// is idempotent, so retried webhook deliveries and re-runs are safe; writes
// for one POS order are serialized by the store's per-order lock.
type Syncer struct {
	repo   *store.Repository
	client *tossplace.Client
}

func New(repo *store.Repository, client *tossplace.Client) *Syncer {
	return &Syncer{repo: repo, client: client}
}

// CompleteOrder applies order.order.completed.v1. The order is fetched
// first because TossPlace is the source of truth: an order it reports
// CANCELLED (e.g. a completed delivery arriving after the cancellation)
// goes through CancelOrder instead.
//
// Otherwise the completion is planned from the order's final line items
// (see PlanOrderCompletion) — TossPlace's "한 번에 결제" can move items
// between POS orders, so a web row may have left this POS order or come in
// from another — and applied in one transaction together with the POS
// charge (store.ApplyPOSCompletion); then the bill's payments are synced.
//
// When the plan cannot be made (the order, or the origin of an item that
// may have moved in, cannot be fetched), nothing is guessed: the bill is
// marked PAID without a charge (store.MarkPOSBillCompletionPending) and
// RetryMissingPayments later re-runs the whole completion.
func (s *Syncer) CompleteOrder(ctx context.Context, posOrderID string, orderKey string, completedAt time.Time) error {
	posOrderID = strings.TrimSpace(posOrderID)
	if posOrderID == "" {
		// Payloads without an orderId can only be matched by orderKey.
		order, err := s.repo.GetPaymentOrder(ctx, orderKey)
		if err != nil {
			return fmt.Errorf("load order %q: %w", orderKey, err)
		}
		vat := order.Amount / 11
		_, err = s.repo.CompletePaymentOrderFromPOS(ctx, orderKey, completedAt, vat, order.Amount-vat, 0)
		return err
	}

	if err := s.repo.AttachPOSOrderKey(ctx, posOrderID, orderKey); err != nil {
		return fmt.Errorf("attach order %q to %q: %w", orderKey, posOrderID, err)
	}
	return s.completeOrder(ctx, posOrderID, completedAt)
}

// completeOrder fetches, plans and applies the completion of posOrderID,
// leaving it pending for the retry when TossPlace cannot be read.
func (s *Syncer) completeOrder(ctx context.Context, posOrderID string, completedAt time.Time) error {
	order, err := s.client.GetOrder(ctx, posOrderID)
	if errors.Is(err, tossplace.ErrNotConfigured) {
		// Without Open API access the final lines can never be read, so
		// moves cannot be told apart: the rows linked to the order complete
		// as they are, as they did before moves were tracked.
		if _, _, err := s.repo.CompletePOSBill(ctx, store.CompletePOSBillInput{POSOrderID: posOrderID, CompletedAt: completedAt}); err != nil {
			return fmt.Errorf("complete bill %q: %w", posOrderID, err)
		}
		return fmt.Errorf("POS order %q completed without its line items or payments: %w", posOrderID, err)
	}
	if err != nil {
		return s.leaveCompletionPending(ctx, posOrderID, completedAt, fmt.Errorf("fetch POS order %q: %w", posOrderID, err))
	}
	if order.OrderState == orderStateCancelled {
		log.Printf("possync: completed event for POS order %q that TossPlace reports CANCELLED; applying the cancellation", posOrderID)
		return s.CancelOrder(ctx, posOrderID, "", orderCancelledAt(order, completedAt))
	}

	completion, err := PlanOrderCompletion(ctx, s.repo, s.client, posOrderID, order, completedAt)
	if err != nil {
		return s.leaveCompletionPending(ctx, posOrderID, completedAt, err)
	}
	if completion.RowsOnOrder == 0 && isEmptyPlan(completion.Plan) {
		state, err := s.repo.GetPOSBillSyncState(ctx, posOrderID)
		if err != nil {
			return fmt.Errorf("load bill %q: %w", posOrderID, err)
		}
		if !state.Exists {
			// Nothing of ours is on the order and nothing is to be recorded.
			return nil
		}
	}
	if _, err := s.repo.ApplyPOSCompletion(ctx, completion.Input); err != nil {
		return fmt.Errorf("apply completion of %q: %w", posOrderID, err)
	}
	return s.SyncPayments(ctx, posOrderID)
}

// leaveCompletionPending marks the bill for the retry (see CompleteOrder),
// stores whatever payments TossPlace reports without marking them synced,
// and returns cause.
func (s *Syncer) leaveCompletionPending(ctx context.Context, posOrderID string, completedAt time.Time, cause error) error {
	if err := s.repo.MarkPOSBillCompletionPending(ctx, posOrderID, completedAt); err != nil {
		return fmt.Errorf("%v (could not mark the completion pending: %w)", cause, err)
	}
	s.recordPaymentsUnsynced(ctx, posOrderID)
	return fmt.Errorf("completion of POS order %q left for retry: %w", posOrderID, cause)
}

func isEmptyPlan(plan CompletionPlan) bool {
	return len(plan.CompleteRowIDs) == 0 && len(plan.MoveOutRowIDs) == 0 && len(plan.AdoptRowIDs) == 0 && len(plan.Natives) == 0
}

// CancelOrder applies order.order.cancelled.v1 to every order on the POS
// order, then re-fetches the bill's payments so a refunded payment recorded
// as APPROVED stops counting. A failed re-fetch is logged; the cancelled
// bill stays claimable by RetryMissingPayments. An unknown POS order is
// ignored.
func (s *Syncer) CancelOrder(ctx context.Context, posOrderID string, orderKey string, cancelledAt time.Time) error {
	posOrderID = strings.TrimSpace(posOrderID)
	if posOrderID == "" {
		_, err := s.repo.CancelPaymentOrder(ctx, orderKey, cancelledAt)
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		return err
	}
	found, err := s.repo.CancelPOSBill(ctx, posOrderID, orderKey, cancelledAt)
	if err != nil {
		return fmt.Errorf("cancel bill %q: %w", posOrderID, err)
	}
	if !found {
		log.Printf("possync: cancelled event for unknown POS order %q", posOrderID)
		return nil
	}
	if err := s.SyncPayments(ctx, posOrderID); err != nil {
		log.Printf("possync: could not refresh payments after cancelling %q (left for retry): %v", posOrderID, err)
	}
	return nil
}

// SyncPayments replaces what we know about a bill's payments with
// TossPlace's full list and marks the bill as synced — unless the list does
// not account for a PAID bill (see PaymentMismatch), or the bill's status
// changed while the list was being fetched. Either way the payments are
// stored, and the bill stays eligible for RetryMissingPayments.
func (s *Syncer) SyncPayments(ctx context.Context, posOrderID string) error {
	state, err := s.repo.GetPOSBillSyncState(ctx, posOrderID)
	if err != nil {
		return fmt.Errorf("load bill %q: %w", posOrderID, err)
	}
	payments, err := s.client.GetPaymentsByOrderID(ctx, posOrderID)
	if err != nil {
		return fmt.Errorf("fetch payments for %q: %w", posOrderID, err)
	}
	inputs := paymentInputs(payments)

	status := billStatusOpen
	if state.Exists {
		status = state.Status
	}
	var chargeTotal int64
	if state.TotalAmount != nil {
		chargeTotal = *state.TotalAmount
	}
	if reason := PaymentMismatch(status, chargeTotal, payments); reason != "" {
		log.Printf("possync: payments for POS order %q do not account for the bill (%s); stored without marking synced", posOrderID, reason)
		if err := s.repo.UpsertPOSPayments(ctx, posOrderID, inputs, false); err != nil {
			return fmt.Errorf("store payments for %q: %w", posOrderID, err)
		}
		return nil
	}
	synced, err := s.repo.SyncPOSPayments(ctx, posOrderID, inputs, status)
	if err != nil {
		return fmt.Errorf("store payments for %q: %w", posOrderID, err)
	}
	if !synced {
		log.Printf("possync: bill %q changed from %s while its payments were fetched; left unsynced for retry", posOrderID, status)
	}
	return nil
}

// recordPaymentsUnsynced stores whatever payments TossPlace reports without
// marking the bill's list complete. Failures are only logged.
func (s *Syncer) recordPaymentsUnsynced(ctx context.Context, posOrderID string) {
	payments, err := s.client.GetPaymentsByOrderID(ctx, posOrderID)
	if err != nil {
		log.Printf("possync: could not fetch payments for %q: %v", posOrderID, err)
		return
	}
	if err := s.repo.UpsertPOSPayments(ctx, posOrderID, paymentInputs(payments), false); err != nil {
		log.Printf("possync: could not store payments for %q: %v", posOrderID, err)
	}
}

// PaymentMismatch reports why a complete payment list does not account for
// a bill, or "" when it does (or the bill is not PAID). A PAID bill needs at
// least one APPROVED payment, and when the POS charge is known (> 0) the
// APPROVED amounts must add up to it. A bill left unsynced for this keeps
// using its menu amounts in the stats and is re-fetched by the retry.
func PaymentMismatch(billStatus string, chargeTotal int64, payments []tossplace.Payment) string {
	if billStatus != billStatusPaid {
		return ""
	}
	var approvedCount int
	var approvedSum int64
	for _, payment := range payments {
		if payment.State == paymentStateApproved {
			approvedCount++
			approvedSum += payment.Amount
		}
	}
	if approvedCount == 0 {
		return "paid bill has no APPROVED payment"
	}
	if chargeTotal > 0 && approvedSum != chargeTotal {
		return fmt.Sprintf("APPROVED payments total %d, POS charged %d", approvedSum, chargeTotal)
	}
	return ""
}

// RecordPayment stores one payment carried by a payment.payment.* event.
func (s *Syncer) RecordPayment(ctx context.Context, payment tossplace.Payment) error {
	if strings.TrimSpace(payment.ID) == "" || strings.TrimSpace(payment.OrderID) == "" {
		return store.ErrInvalidInput
	}
	return s.repo.UpsertPOSPayments(ctx, payment.OrderID, []store.POSPaymentInput{paymentInput(payment)}, false)
}

// RetryMissingPayments re-syncs up to limit bills whose payment list is not
// known to be complete (see store.ClaimPOSBillsNeedingPaymentSync). A PAID
// bill whose POS charge was never recorded — its completion could not be
// planned when it arrived (see CompleteOrder) — first gets the whole
// completion re-run. It runs piggybacked on incoming webhooks
// rather than on a timer, since an idle Cloud Run instance does not get CPU
// for background work; failures are logged and retried later.
func (s *Syncer) RetryMissingPayments(ctx context.Context, limit int) {
	posOrderIDs, err := s.repo.ClaimPOSBillsNeedingPaymentSync(ctx, limit)
	if err != nil {
		log.Printf("possync: could not claim bills for payment retry: %v", err)
		return
	}
	for _, posOrderID := range posOrderIDs {
		if err := s.resyncBill(ctx, posOrderID); err != nil {
			log.Printf("possync: payment retry failed: %v", err)
		}
	}
}

func (s *Syncer) resyncBill(ctx context.Context, posOrderID string) error {
	state, err := s.repo.GetPOSBillSyncState(ctx, posOrderID)
	if err != nil {
		return fmt.Errorf("load bill %q: %w", posOrderID, err)
	}
	if !state.Exists || state.Status != billStatusPaid || state.TotalAmount != nil {
		return s.SyncPayments(ctx, posOrderID)
	}

	completedAt := time.Now().UTC()
	if state.CompletedAt != nil {
		completedAt = *state.CompletedAt
	}
	return s.completeOrder(ctx, posOrderID, completedAt)
}

// orderCancelledAt is the order's cancelledAt, else fallback.
func orderCancelledAt(order tossplace.Order, fallback time.Time) time.Time {
	if parsed := ParseTimestamp(order.CancelledAt); !parsed.IsZero() {
		return parsed
	}
	return fallback
}

func paymentInputs(payments []tossplace.Payment) []store.POSPaymentInput {
	inputs := make([]store.POSPaymentInput, 0, len(payments))
	for _, payment := range payments {
		inputs = append(inputs, paymentInput(payment))
	}
	return inputs
}

// paymentInput keeps only what pos_payments stores. A payment reported
// without approvedAt falls back to its createdAt, so it still lands on a
// day in the payment-based stats.
func paymentInput(payment tossplace.Payment) store.POSPaymentInput {
	approvedAt := ParseTimestamp(payment.ApprovedAt)
	if approvedAt.IsZero() {
		approvedAt = ParseTimestamp(payment.CreatedAt)
	}
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
		CancelledAt:     ParseTimestamp(payment.CancelledAt),
	}
}

// timestampLayoutWithoutTimezone handles the timezone-less timestamps
// TossPlace's docs show (e.g. "2025-09-01T00:00:00").
const timestampLayoutWithoutTimezone = "2006-01-02T15:04:05"

// ParseTimestamp parses an optional TossPlace timestamp (RFC3339, or the
// timezone-less layout read as UTC). Empty or unparseable input returns
// the zero time.
func ParseTimestamp(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}
	}
	if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		return parsed
	}
	if parsed, err := time.Parse(timestampLayoutWithoutTimezone, raw); err == nil {
		return parsed.UTC()
	}
	log.Printf("possync: could not parse timestamp %q", raw)
	return time.Time{}
}
