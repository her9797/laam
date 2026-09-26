package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
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

// posOrderLockNamespace is the first key of the two-key advisory lock that
// serializes writes to one POS order's bill, rows and payments; the second
// key is hashtext(pos_order_id). Duplicate webhook deliveries and the
// backfill can process the same POS order at once, and the POS-native line
// diff (read the recorded rows, insert what is missing) is only safe when
// no one else runs it for that order at the same time.
//
// The lock is transaction-scoped (pg_advisory_xact_lock) and everything done
// under it runs on that transaction: a waiter never needs a second pooled
// connection while holding one, and the lock also works through a
// transaction-mode connection pooler, where session locks would not.
const posOrderLockNamespace = 815234908

func lockPOSOrder(ctx context.Context, tx pgx.Tx, posOrderID string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1::int, hashtext($2))`, posOrderLockNamespace, posOrderID); err != nil {
		return classifyError(err)
	}
	return nil
}

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
	if err := lockPOSOrder(ctx, tx, posOrderID); err != nil {
		return "", false, err
	}

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
// for rejected orders and for refunded sales). A bill that exists without
// any payment_orders row (created by payment events alone) is cancelled
// too. found is false when neither a payment_orders row nor a bill belongs
// to the POS order.
//
// Cancelling clears payments_synced_at: the payment list recorded so far
// may still show payments the cancellation refunds, so the bill becomes
// eligible for ClaimPOSBillsNeedingPaymentSync until its payments are
// fetched again. It also counts as a payment sync attempt, since the caller
// re-fetches the payments right after.
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
	if err := lockPOSOrder(ctx, tx, posOrderID); err != nil {
		return false, err
	}

	hasRows, err := attachOrderKeyToPOSOrder(ctx, tx, posOrderID, orderKey)
	if err != nil {
		return false, err
	}
	if hasRows {
		if _, err := ensurePOSBill(ctx, tx, posOrderID); err != nil {
			return false, err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE payment_orders
			SET status = 'CANCELLED', updated_at = NOW()
			WHERE pos_order_id = $1 AND status IN ('READY', 'ACKNOWLEDGED', 'DONE')
		`, posOrderID); err != nil {
			return false, classifyError(err)
		}
	}
	tag, err := tx.Exec(ctx, `
		UPDATE pos_bills
		SET status = 'CANCELLED',
			cancelled_at = COALESCE(cancelled_at, $2),
			payments_synced_at = NULL,
			payment_sync_attempted_at = NOW(),
			updated_at = NOW()
		WHERE pos_order_id = $1
	`, posOrderID, cancelledAt)
	if err != nil {
		return false, classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

// POSBillSyncState is what the payment sync needs to know about a bill
// before trusting a fetched payment list.
type POSBillSyncState struct {
	Exists bool
	Status string
	// TotalAmount is the POS charge, nil until an order fetch recorded it
	// (see SetPOSBillCharge).
	TotalAmount *int64
	CompletedAt *time.Time
}

// GetPOSBillSyncState reads the bill for posOrderID; a missing bill is
// reported with Exists false, not an error.
func (r *Repository) GetPOSBillSyncState(ctx context.Context, posOrderID string) (POSBillSyncState, error) {
	state := POSBillSyncState{}
	err := r.pool.QueryRow(ctx, `
		SELECT status, total_amount, completed_at FROM pos_bills WHERE pos_order_id = $1
	`, strings.TrimSpace(posOrderID)).Scan(&state.Status, &state.TotalAmount, &state.CompletedAt)
	switch {
	case err == nil:
		state.Exists = true
		return state, nil
	case errors.Is(err, pgx.ErrNoRows):
		return state, nil
	default:
		return POSBillSyncState{}, classifyError(err)
	}
}

// RecordPOSNativeLines records the POS order's line items that no
// payment_orders row represents yet. diff receives every row already on the
// POS order (whatever its status) and returns the lines to insert; it runs
// under the POS order's lock, in the same transaction as the inserts, so
// concurrent deliveries of the same completed event (or the backfill racing
// a webhook) cannot each see the line missing and record it twice. Nothing
// is recorded on a bill that is already CANCELLED.
func (r *Repository) RecordPOSNativeLines(ctx context.Context, posOrderID string, diff func(existing []POSOrderLine) []CreatePOSNativeOrderInput) (int, error) {
	posOrderID = strings.TrimSpace(posOrderID)
	if posOrderID == "" {
		return 0, ErrInvalidInput
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if err := lockPOSOrder(ctx, tx, posOrderID); err != nil {
		return 0, err
	}

	var cancelled bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM pos_bills WHERE pos_order_id = $1 AND status = 'CANCELLED')
	`, posOrderID).Scan(&cancelled); err != nil {
		return 0, classifyError(err)
	}
	if cancelled {
		return 0, nil
	}
	existing, err := listPOSOrderLines(ctx, tx, posOrderID)
	if err != nil {
		return 0, err
	}
	inputs := diff(existing)
	for _, input := range inputs {
		if input.Amount <= 0 {
			return 0, ErrInvalidInput
		}
		// Same row CreatePOSNativeOrder writes, inserted on this
		// transaction so it stays under the lock.
		if _, err := tx.Exec(ctx, `
			INSERT INTO payment_orders (
				id, menu_item_name, category_name, table_number, amount,
				status, payment_method, approved_at, vat, supplied_amount, tax_free_amount,
				pos_sync_status, pos_order_id, created_at, bill_id
			) VALUES ($1, $2, $3, '', $4, 'DONE', 'POS', $5, $6, $7, 0, 'SUCCEEDED', $8, COALESCE($9, NOW()),
				(SELECT id FROM pos_bills WHERE pos_order_id = $8))
		`, nextID("order"), input.MenuItemName, input.CategoryName, input.Amount,
			input.ApprovedAt, input.VAT, input.SuppliedAmount, posOrderID,
			nullableTime(input.OrderedAt)); err != nil {
			return 0, classifyError(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(inputs), nil
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
// state (APPROVED -> CANCELLED), but a CANCELLED payment never goes back
// to APPROVED: a retried approval event, or a payment list fetched before
// the cancellation committed, is older news. fullSync marks the bill's
// payment list as complete — only set it when payments is the whole list
// from GetPaymentsByOrderID, not a single payment event.
func (r *Repository) UpsertPOSPayments(ctx context.Context, posOrderID string, payments []POSPaymentInput, fullSync bool) error {
	_, err := r.upsertPOSPayments(ctx, posOrderID, payments, fullSync, "")
	return err
}

// SyncPOSPayments stores a bill's complete payment list like
// UpsertPOSPayments(fullSync=true), but marks the list synced only while
// the bill's status is still expectStatus — the status the caller saw
// before fetching the list. If an order event changed the bill in between
// (e.g. it was cancelled), the fetched list may predate that change, so the
// bill stays unsynced for ClaimPOSBillsNeedingPaymentSync. synced reports
// whether the bill was marked.
func (r *Repository) SyncPOSPayments(ctx context.Context, posOrderID string, payments []POSPaymentInput, expectStatus string) (bool, error) {
	if strings.TrimSpace(expectStatus) == "" {
		return false, ErrInvalidInput
	}
	return r.upsertPOSPayments(ctx, posOrderID, payments, true, expectStatus)
}

func (r *Repository) upsertPOSPayments(ctx context.Context, posOrderID string, payments []POSPaymentInput, fullSync bool, expectStatus string) (bool, error) {
	posOrderID = strings.TrimSpace(posOrderID)
	if posOrderID == "" {
		return false, ErrInvalidInput
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if err := lockPOSOrder(ctx, tx, posOrderID); err != nil {
		return false, err
	}

	billID, err := ensurePOSBill(ctx, tx, posOrderID)
	if err != nil {
		return false, err
	}
	for _, payment := range payments {
		if strings.TrimSpace(payment.ID) == "" {
			return false, ErrInvalidInput
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO pos_payments (
				id, bill_id, state, source_type, payment_method, card_brand, amount,
				tax_amount, supply_amount, tax_exempt_amount, approved_no, approved_at, cancelled_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (id) DO UPDATE SET
				bill_id = EXCLUDED.bill_id,
				state = CASE WHEN pos_payments.state = 'CANCELLED' THEN pos_payments.state ELSE EXCLUDED.state END,
				source_type = EXCLUDED.source_type,
				payment_method = EXCLUDED.payment_method,
				card_brand = EXCLUDED.card_brand,
				amount = EXCLUDED.amount,
				tax_amount = EXCLUDED.tax_amount,
				supply_amount = EXCLUDED.supply_amount,
				tax_exempt_amount = EXCLUDED.tax_exempt_amount,
				approved_no = EXCLUDED.approved_no,
				approved_at = COALESCE(EXCLUDED.approved_at, pos_payments.approved_at),
				cancelled_at = CASE
					WHEN pos_payments.state = 'CANCELLED' THEN COALESCE(pos_payments.cancelled_at, EXCLUDED.cancelled_at)
					ELSE COALESCE(EXCLUDED.cancelled_at, pos_payments.cancelled_at)
				END,
				updated_at = NOW()
		`, payment.ID, billID, payment.State, payment.SourceType, payment.PaymentMethod, payment.CardBrand,
			payment.Amount, payment.TaxAmount, payment.SupplyAmount, payment.TaxExemptAmount, payment.ApprovedNo,
			nullableTime(payment.ApprovedAt), nullableTime(payment.CancelledAt)); err != nil {
			return false, classifyError(err)
		}
	}
	synced := false
	if fullSync {
		tag, err := tx.Exec(ctx, `
			UPDATE pos_bills SET payments_synced_at = NOW(), updated_at = NOW()
			WHERE id = $1 AND ($2 = '' OR status = $2)
		`, billID, expectStatus)
		if err != nil {
			return false, classifyError(err)
		}
		synced = tag.RowsAffected() > 0
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return synced, nil
}

// ClaimPOSBillsNeedingPaymentSync returns up to limit bills whose payment
// list still has to be fetched: PAID bills never synced successfully, and
// CANCELLED bills that still have an APPROVED payment recorded and have not
// been re-synced since the cancellation (CancelPOSBill clears
// payments_synced_at). Each is stamped as attempted so a bill TossPlace
// keeps failing on is retried at most once per paymentSyncRetryInterval
// instead of on every call.
func (r *Repository) ClaimPOSBillsNeedingPaymentSync(ctx context.Context, limit int) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		UPDATE pos_bills
		SET payment_sync_attempted_at = NOW()
		WHERE id IN (
			SELECT id FROM pos_bills
			WHERE (
					status = 'PAID'
					OR (status = 'CANCELLED' AND EXISTS (
						SELECT 1 FROM pos_payments p WHERE p.bill_id = pos_bills.id AND p.state = 'APPROVED'
					))
				)
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
	return listPOSOrderLines(ctx, r.pool, posOrderID)
}

func listPOSOrderLines(ctx context.Context, q tableQuerier, posOrderID string) ([]POSOrderLine, error) {
	rows, err := q.Query(ctx, `
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
