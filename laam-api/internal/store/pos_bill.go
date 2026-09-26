package store

import (
	"context"
	"strings"
	"time"
)

// A pos_bills row is one TossPlace (POS) order — the "계산서" every web
// order and POS-native line item on it belongs to. In plugin mode several
// web orders on the same table share one POS order (the plugin appends
// them with addMenu), so they share one bill; in open-api mode every web
// order opens its own POS order and so its own bill. pos_payments holds the
// TossPlace payments recorded against a bill (several for a split bill).
//
// Bill status is driven by TossPlace order events only (OPEN until
// order.completed, then PAID; CANCELLED on order.cancelled). Payment events
// only add or update pos_payments rows: a cancelled payment followed by a
// new one (e.g. card cancelled, then paid in cash) is ordinary at the POS
// and must not flip the bill's status.

// paymentSyncRetryInterval is how long a bill whose payments could not be
// fetched waits before ClaimPOSBillsNeedingPaymentSync hands it out again.
const paymentSyncRetryInterval = "5 minutes"

// POSOrderLine is the snapshot of one payment_orders row on a POS order
// that the completed-webhook handler diffs against TossPlace's line items
// to find the items rung up directly on the POS.
type POSOrderLine struct {
	MenuItemName string
	CategoryName string
	Amount       int64
}

type CompletePOSBillInput struct {
	POSOrderID string
	// OrderKey is the webhook's orderKey. A row whose id matches it but has
	// no pos_order_id yet is attached to POSOrderID first, so orders synced
	// before pos_order_id was reliably stored still complete.
	OrderKey    string
	CompletedAt time.Time
}

// POSPaymentInput is one TossPlace payment to record against the bill for
// its POS order. A zero ApprovedAt/CancelledAt is stored as NULL.
type POSPaymentInput struct {
	ID              string
	State           string
	SourceType      string
	PaymentMethod   string
	CardBrand       string
	Amount          int64
	TaxAmount       int64
	SupplyAmount    int64
	TaxExemptAmount int64
	ApprovedNo      string
	ApprovedAt      time.Time
	CancelledAt     time.Time
}

// EnsurePOSBill creates the bill for posOrderID if it does not exist yet
// and links every payment_orders row on that POS order to it. It is called
// whenever a web order receives its pos_order_id so unpaid orders already
// show up grouped as an OPEN bill.
func (r *Repository) EnsurePOSBill(ctx context.Context, posOrderID string) (string, error) {
	posOrderID = strings.TrimSpace(posOrderID)
	if posOrderID == "" {
		return "", ErrInvalidInput
	}
	return ensurePOSBill(ctx, r.pool, posOrderID)
}

func ensurePOSBill(ctx context.Context, q tableQuerier, posOrderID string) (string, error) {
	var billID string
	if err := q.QueryRow(ctx, `
		INSERT INTO pos_bills (id, pos_order_id, table_number, opened_at)
		VALUES (
			$1,
			$2,
			COALESCE((
				SELECT table_number FROM payment_orders
				WHERE pos_order_id = $2 AND table_number <> ''
				ORDER BY created_at, id
				LIMIT 1
			), ''),
			COALESCE((SELECT MIN(created_at) FROM payment_orders WHERE pos_order_id = $2), NOW())
		)
		ON CONFLICT (pos_order_id) DO UPDATE SET
			table_number = CASE WHEN pos_bills.table_number = '' THEN EXCLUDED.table_number ELSE pos_bills.table_number END,
			opened_at = LEAST(pos_bills.opened_at, EXCLUDED.opened_at),
			updated_at = NOW()
		RETURNING id
	`, nextID("bill"), posOrderID).Scan(&billID); err != nil {
		return "", classifyError(err)
	}
	if _, err := q.Exec(ctx, `
		UPDATE payment_orders
		SET bill_id = $1
		WHERE pos_order_id = $2 AND bill_id IS DISTINCT FROM $1
	`, billID, posOrderID); err != nil {
		return "", classifyError(err)
	}
	return billID, nil
}

// attachOrderKeyToPOSOrder gives the row named by orderKey the POS order ID
// when it has none yet (see CompletePOSBillInput.OrderKey), then reports
// whether any payment_orders row now belongs to posOrderID.
func attachOrderKeyToPOSOrder(ctx context.Context, q tableQuerier, posOrderID string, orderKey string) (bool, error) {
	if orderKey = strings.TrimSpace(orderKey); orderKey != "" {
		if _, err := q.Exec(ctx, `
			UPDATE payment_orders SET pos_order_id = $1, updated_at = NOW()
			WHERE id = $2 AND pos_order_id IS NULL
		`, posOrderID, orderKey); err != nil {
			return false, classifyError(err)
		}
	}
	var exists bool
	if err := q.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM payment_orders WHERE pos_order_id = $1)
	`, posOrderID).Scan(&exists); err != nil {
		return false, classifyError(err)
	}
	return exists, nil
}

// CompletePOSBill applies a TossPlace order.completed event to every order
// on that POS order at once — web orders appended to a table's POS order
// all complete together, not only the one whose id is the POS orderKey.
// found is false when no payment_orders row belongs to the POS order (it
// was rung up entirely on the POS); nothing is written then.
//
// READY/ACKNOWLEDGED rows become DONE; CANCELLED rows are never resurrected.
// Idempotent for retried deliveries. Completing also counts as a payment
// sync attempt, since the caller fetches the bill's payments right after.
func (r *Repository) CompletePOSBill(ctx context.Context, input CompletePOSBillInput) (string, bool, error) {
	posOrderID := strings.TrimSpace(input.POSOrderID)
	if posOrderID == "" {
		return "", false, ErrInvalidInput
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)

	found, err := attachOrderKeyToPOSOrder(ctx, tx, posOrderID, input.OrderKey)
	if err != nil || !found {
		return "", false, err
	}
	billID, err := ensurePOSBill(ctx, tx, posOrderID)
	if err != nil {
		return "", false, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE payment_orders
		SET status = 'DONE',
			payment_method = 'POS',
			approved_at = $2,
			vat = amount / 11,
			supplied_amount = amount - amount / 11,
			tax_free_amount = 0,
			updated_at = NOW()
		WHERE pos_order_id = $1 AND status IN ('READY', 'ACKNOWLEDGED')
	`, posOrderID, input.CompletedAt); err != nil {
		return "", false, classifyError(err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE pos_bills
		SET status = CASE
				WHEN status = 'CANCELLED'
					OR NOT EXISTS (SELECT 1 FROM payment_orders WHERE bill_id = $1 AND status <> 'CANCELLED')
				THEN 'CANCELLED'
				ELSE 'PAID'
			END,
			completed_at = COALESCE(completed_at, $2),
			payment_sync_attempted_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
	`, billID, input.CompletedAt); err != nil {
		return "", false, classifyError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", false, err
	}
	return billID, true, nil
}

// CancelPOSBill applies a TossPlace order.cancelled event to every order on
// that POS order (READY, ACKNOWLEDGED and DONE alike — TossPlace sends it
// for rejected orders and for refunded sales). found is false when no
// payment_orders row belongs to the POS order.
func (r *Repository) CancelPOSBill(ctx context.Context, posOrderID string, orderKey string, cancelledAt time.Time) (bool, error) {
	posOrderID = strings.TrimSpace(posOrderID)
	if posOrderID == "" {
		return false, ErrInvalidInput
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	found, err := attachOrderKeyToPOSOrder(ctx, tx, posOrderID, orderKey)
	if err != nil || !found {
		return false, err
	}
	billID, err := ensurePOSBill(ctx, tx, posOrderID)
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE payment_orders
		SET status = 'CANCELLED', updated_at = NOW()
		WHERE pos_order_id = $1 AND status IN ('READY', 'ACKNOWLEDGED', 'DONE')
	`, posOrderID); err != nil {
		return false, classifyError(err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE pos_bills
		SET status = 'CANCELLED', cancelled_at = COALESCE(cancelled_at, $2), updated_at = NOW()
		WHERE id = $1
	`, billID, cancelledAt); err != nil {
		return false, classifyError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

// SetPOSBillCharge records what the POS actually charged for the order
// (after order-level discounts). A missing bill is not an error.
func (r *Repository) SetPOSBillCharge(ctx context.Context, posOrderID string, totalAmount int64, discountAmount int64) error {
	if _, err := r.pool.Exec(ctx, `
		UPDATE pos_bills
		SET total_amount = $2, discount_amount = $3, updated_at = NOW()
		WHERE pos_order_id = $1
	`, strings.TrimSpace(posOrderID), totalAmount, discountAmount); err != nil {
		return classifyError(err)
	}
	return nil
}

// UpsertPOSPayments records TossPlace payments against the bill for
// posOrderID, creating an OPEN bill when a payment event arrives before the
// order's completion. Existing payments are overwritten with the newer
// state (e.g. APPROVED -> CANCELLED). fullSync marks the bill's payment
// list as complete — only set it when payments is the whole list from
// GetPaymentsByOrderID, not a single payment event.
func (r *Repository) UpsertPOSPayments(ctx context.Context, posOrderID string, payments []POSPaymentInput, fullSync bool) error {
	posOrderID = strings.TrimSpace(posOrderID)
	if posOrderID == "" {
		return ErrInvalidInput
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	billID, err := ensurePOSBill(ctx, tx, posOrderID)
	if err != nil {
		return err
	}
	for _, payment := range payments {
		if strings.TrimSpace(payment.ID) == "" {
			return ErrInvalidInput
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO pos_payments (
				id, bill_id, state, source_type, payment_method, card_brand, amount,
				tax_amount, supply_amount, tax_exempt_amount, approved_no, approved_at, cancelled_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (id) DO UPDATE SET
				bill_id = EXCLUDED.bill_id,
				state = EXCLUDED.state,
				source_type = EXCLUDED.source_type,
				payment_method = EXCLUDED.payment_method,
				card_brand = EXCLUDED.card_brand,
				amount = EXCLUDED.amount,
				tax_amount = EXCLUDED.tax_amount,
				supply_amount = EXCLUDED.supply_amount,
				tax_exempt_amount = EXCLUDED.tax_exempt_amount,
				approved_no = EXCLUDED.approved_no,
				approved_at = COALESCE(EXCLUDED.approved_at, pos_payments.approved_at),
				cancelled_at = COALESCE(EXCLUDED.cancelled_at, pos_payments.cancelled_at),
				updated_at = NOW()
		`, payment.ID, billID, payment.State, payment.SourceType, payment.PaymentMethod, payment.CardBrand,
			payment.Amount, payment.TaxAmount, payment.SupplyAmount, payment.TaxExemptAmount, payment.ApprovedNo,
			nullableTime(payment.ApprovedAt), nullableTime(payment.CancelledAt)); err != nil {
			return classifyError(err)
		}
	}
	if fullSync {
		if _, err := tx.Exec(ctx, `
			UPDATE pos_bills SET payments_synced_at = NOW(), updated_at = NOW() WHERE id = $1
		`, billID); err != nil {
			return classifyError(err)
		}
	}
	return tx.Commit(ctx)
}

// ClaimPOSBillsNeedingPaymentSync returns up to limit PAID bills whose
// payment list has never been fetched successfully, stamping each as
// attempted so a bill TossPlace keeps failing on is retried at most once
// per paymentSyncRetryInterval instead of on every call.
func (r *Repository) ClaimPOSBillsNeedingPaymentSync(ctx context.Context, limit int) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		UPDATE pos_bills
		SET payment_sync_attempted_at = NOW()
		WHERE id IN (
			SELECT id FROM pos_bills
			WHERE status = 'PAID'
				AND payments_synced_at IS NULL
				AND (payment_sync_attempted_at IS NULL OR payment_sync_attempted_at < NOW() - INTERVAL '`+paymentSyncRetryInterval+`')
			ORDER BY payment_sync_attempted_at NULLS FIRST, completed_at, id
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING pos_order_id
	`, limit)
	if err != nil {
		return nil, classifyError(err)
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ListPOSOrderLines returns every payment_orders row on posOrderID,
// whatever its status, for the POS-native line item diff.
func (r *Repository) ListPOSOrderLines(ctx context.Context, posOrderID string) ([]POSOrderLine, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT menu_item_name, category_name, amount
		FROM payment_orders
		WHERE pos_order_id = $1
		ORDER BY created_at, id
	`, strings.TrimSpace(posOrderID))
	if err != nil {
		return nil, classifyError(err)
	}
	defer rows.Close()
	lines := make([]POSOrderLine, 0)
	for rows.Next() {
		var line POSOrderLine
		if err := rows.Scan(&line.MenuItemName, &line.CategoryName, &line.Amount); err != nil {
			return nil, err
		}
		lines = append(lines, line)
	}
	return lines, rows.Err()
}

// ListPOSOrderIDsForBackfill returns every distinct POS order ID a
// payment_orders row points at, oldest first.
func (r *Repository) ListPOSOrderIDsForBackfill(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT pos_order_id
		FROM payment_orders
		WHERE pos_order_id IS NOT NULL AND pos_order_id <> ''
		GROUP BY pos_order_id
		ORDER BY MIN(created_at), pos_order_id
	`)
	if err != nil {
		return nil, classifyError(err)
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
