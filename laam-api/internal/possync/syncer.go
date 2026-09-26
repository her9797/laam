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

// CompleteOrder applies order.order.completed.v1: every web order on the
// POS order becomes DONE, items rung up directly on the POS are recorded
// as POS-native rows, the bill is marked PAID with the POS's charged total,
// and the bill's payments are fetched.
//
// The order is fetched first because TossPlace is the source of truth for
// its state: an order it reports CANCELLED (e.g. a completed delivery
// arriving after the cancellation) goes through CancelOrder instead.
//
// When the order cannot be fetched, the web orders are still completed and
// the payments recorded, but the bill's payment list is left unsynced and
// its charge unset, so RetryMissingPayments later re-runs the order refresh
// (POS-native lines and charge) before marking it synced.
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

	order, orderErr := s.client.GetOrder(ctx, posOrderID)
	if orderErr == nil && order.OrderState == orderStateCancelled {
		log.Printf("possync: completed event for POS order %q that TossPlace reports CANCELLED; applying the cancellation", posOrderID)
		return s.CancelOrder(ctx, posOrderID, orderKey, orderCancelledAt(order, completedAt))
	}

	_, found, err := s.repo.CompletePOSBill(ctx, store.CompletePOSBillInput{POSOrderID: posOrderID, OrderKey: orderKey, CompletedAt: completedAt})
	if err != nil {
		return fmt.Errorf("complete bill %q: %w", posOrderID, err)
	}
	if orderErr != nil {
		if !found {
			return fmt.Errorf("fetch POS-native order %q: %w", posOrderID, orderErr)
		}
		s.recordPaymentsUnsynced(ctx, posOrderID)
		return fmt.Errorf("fetch POS order %q for native items/charge (left for retry): %w", posOrderID, orderErr)
	}
	return s.applyOrder(ctx, posOrderID, order, completedAt, found)
}

// applyOrder records the fetched order's POS-native lines and charge on the
// bill, completes a bill that only POS-native lines make up, then syncs the
// bill's payments.
func (s *Syncer) applyOrder(ctx context.Context, posOrderID string, order tossplace.Order, completedAt time.Time, found bool) error {
	if _, err := s.recordNativeLines(ctx, posOrderID, order, completedAt); err != nil {
		return err
	}
	if !found {
		// Completing is idempotent, and found now also covers native lines
		// a concurrent delivery recorded first.
		var err error
		if _, found, err = s.repo.CompletePOSBill(ctx, store.CompletePOSBillInput{POSOrderID: posOrderID, CompletedAt: completedAt}); err != nil {
			return fmt.Errorf("complete POS-native bill %q: %w", posOrderID, err)
		}
		if !found {
			return nil
		}
	}
	if err := s.repo.SetPOSBillCharge(ctx, posOrderID, order.ChargePrice.TotalAmount, order.ChargePrice.DiscountAmount); err != nil {
		return fmt.Errorf("set bill charge %q: %w", posOrderID, err)
	}
	return s.SyncPayments(ctx, posOrderID)
}

func (s *Syncer) recordNativeLines(ctx context.Context, posOrderID string, order tossplace.Order, completedAt time.Time) (int, error) {
	approvedAt := completedAt
	if parsed := ParseTimestamp(order.CompletedAt); !parsed.IsZero() {
		approvedAt = parsed
	}
	created, err := s.repo.RecordPOSNativeLines(ctx, posOrderID, func(existing []store.POSOrderLine) []store.CreatePOSNativeOrderInput {
		return NativeOrderInputs(posOrderID, order, existing, approvedAt)
	})
	if err != nil {
		return 0, fmt.Errorf("record POS-native lines for %q: %w", posOrderID, err)
	}
	return created, nil
}

// NativeOrderInputs turns the order's line items that no existing row
// represents (see NativeLines) into POS-native rows approved at approvedAt.
// The order's openedAt is optional; a zero OrderedAt makes the row fall
// back to NOW().
func NativeOrderInputs(posOrderID string, order tossplace.Order, existing []store.POSOrderLine, approvedAt time.Time) []store.CreatePOSNativeOrderInput {
	natives := NativeLines(order.LineItems, existing)
	orderedAt := ParseTimestamp(order.OpenedAt)
	inputs := make([]store.CreatePOSNativeOrderInput, 0, len(natives))
	for _, native := range natives {
		vat := native.Amount / 11
		inputs = append(inputs, store.CreatePOSNativeOrderInput{
			MenuItemName:   native.MenuItemName,
			CategoryName:   native.CategoryName,
			Amount:         native.Amount,
			OrderedAt:      orderedAt,
			ApprovedAt:     approvedAt,
			VAT:            vat,
			SuppliedAmount: native.Amount - vat,
			POSOrderID:     posOrderID,
		})
	}
	return inputs
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
// bill whose POS charge was never recorded — its order fetch failed when it
// completed — first gets the order refresh CompleteOrder could not do
// (POS-native lines and charge). It runs piggybacked on incoming webhooks
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
	order, err := s.client.GetOrder(ctx, posOrderID)
	if err != nil {
		s.recordPaymentsUnsynced(ctx, posOrderID)
		return fmt.Errorf("fetch POS order %q for native items/charge (left for retry): %w", posOrderID, err)
	}
	if order.OrderState == orderStateCancelled {
		return s.CancelOrder(ctx, posOrderID, "", orderCancelledAt(order, completedAt))
	}
	return s.applyOrder(ctx, posOrderID, order, completedAt, true)
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
