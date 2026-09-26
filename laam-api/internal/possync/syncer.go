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

// Syncer applies TossPlace order/payment state to the store. Every method
// is idempotent, so retried webhook deliveries and re-runs are safe.
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
// A payment fetch failure is returned but leaves the bill completed; the
// bill stays eligible for RetryMissingPayments.
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

	_, found, err := s.repo.CompletePOSBill(ctx, store.CompletePOSBillInput{POSOrderID: posOrderID, OrderKey: orderKey, CompletedAt: completedAt})
	if err != nil {
		return fmt.Errorf("complete bill %q: %w", posOrderID, err)
	}

	order, orderErr := s.client.GetOrder(ctx, posOrderID)
	if orderErr != nil {
		if !found {
			return fmt.Errorf("fetch POS-native order %q: %w", posOrderID, orderErr)
		}
		log.Printf("possync: could not fetch POS order %q for native items/charge: %v", posOrderID, orderErr)
	} else {
		created, err := s.recordNativeLines(ctx, posOrderID, order, completedAt)
		if err != nil {
			return err
		}
		if !found && created > 0 {
			if _, _, err := s.repo.CompletePOSBill(ctx, store.CompletePOSBillInput{POSOrderID: posOrderID, CompletedAt: completedAt}); err != nil {
				return fmt.Errorf("complete POS-native bill %q: %w", posOrderID, err)
			}
			found = true
		}
		if found {
			if err := s.repo.SetPOSBillCharge(ctx, posOrderID, order.ChargePrice.TotalAmount, order.ChargePrice.DiscountAmount); err != nil {
				return fmt.Errorf("set bill charge %q: %w", posOrderID, err)
			}
		}
	}
	if !found {
		return nil
	}
	return s.SyncPayments(ctx, posOrderID)
}

func (s *Syncer) recordNativeLines(ctx context.Context, posOrderID string, order tossplace.Order, completedAt time.Time) (int, error) {
	existing, err := s.repo.ListPOSOrderLines(ctx, posOrderID)
	if err != nil {
		return 0, fmt.Errorf("list recorded lines %q: %w", posOrderID, err)
	}
	natives := NativeLines(order.LineItems, existing)
	if len(natives) == 0 {
		return 0, nil
	}

	approvedAt := completedAt
	if parsed := ParseTimestamp(order.CompletedAt); !parsed.IsZero() {
		approvedAt = parsed
	}
	// openedAt is optional; a zero OrderedAt makes the row fall back to NOW().
	orderedAt := ParseTimestamp(order.OpenedAt)
	for _, native := range natives {
		vat := native.Amount / 11
		if _, err := s.repo.CreatePOSNativeOrder(ctx, store.CreatePOSNativeOrderInput{
			MenuItemName:   native.MenuItemName,
			CategoryName:   native.CategoryName,
			Amount:         native.Amount,
			OrderedAt:      orderedAt,
			ApprovedAt:     approvedAt,
			VAT:            vat,
			SuppliedAmount: native.Amount - vat,
			POSOrderID:     posOrderID,
		}); err != nil {
			return 0, fmt.Errorf("record POS-native line for %q: %w", posOrderID, err)
		}
	}
	return len(natives), nil
}

// CancelOrder applies order.order.cancelled.v1 to every order on the POS
// order. An unknown POS order is ignored.
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
	}
	return nil
}

// SyncPayments replaces what we know about a bill's payments with
// TossPlace's full list and marks the bill as synced.
func (s *Syncer) SyncPayments(ctx context.Context, posOrderID string) error {
	payments, err := s.client.GetPaymentsByOrderID(ctx, posOrderID)
	if err != nil {
		return fmt.Errorf("fetch payments for %q: %w", posOrderID, err)
	}
	inputs := make([]store.POSPaymentInput, 0, len(payments))
	for _, payment := range payments {
		inputs = append(inputs, paymentInput(payment))
	}
	if err := s.repo.UpsertPOSPayments(ctx, posOrderID, inputs, true); err != nil {
		return fmt.Errorf("store payments for %q: %w", posOrderID, err)
	}
	return nil
}

// RecordPayment stores one payment carried by a payment.payment.* event.
func (s *Syncer) RecordPayment(ctx context.Context, payment tossplace.Payment) error {
	if strings.TrimSpace(payment.ID) == "" || strings.TrimSpace(payment.OrderID) == "" {
		return store.ErrInvalidInput
	}
	return s.repo.UpsertPOSPayments(ctx, payment.OrderID, []store.POSPaymentInput{paymentInput(payment)}, false)
}

// RetryMissingPayments re-fetches payments for up to limit PAID bills
// whose payment list was never stored. It runs piggybacked on incoming
// webhooks rather than on a timer, since an idle Cloud Run instance does
// not get CPU for background work; failures are logged and retried later.
func (s *Syncer) RetryMissingPayments(ctx context.Context, limit int) {
	posOrderIDs, err := s.repo.ClaimPOSBillsNeedingPaymentSync(ctx, limit)
	if err != nil {
		log.Printf("possync: could not claim bills for payment retry: %v", err)
		return
	}
	for _, posOrderID := range posOrderIDs {
		if err := s.SyncPayments(ctx, posOrderID); err != nil {
			log.Printf("possync: payment retry failed: %v", err)
		}
	}
}

func paymentInput(payment tossplace.Payment) store.POSPaymentInput {
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
		ApprovedAt:      ParseTimestamp(payment.ApprovedAt),
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
