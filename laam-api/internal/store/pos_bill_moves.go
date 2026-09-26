package store

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
)

// TossPlace's "한 번에 결제" can move a line item from one POS order to
// another at payment time: a web row recorded on POS order X (pos_order_id
// = X, bill_id = X's bill) may end up paid inside POS order Y. A completion
// planner decides, per completed POS order, which of its rows were paid
// there, which moved out, and which rows of other POS orders moved in;
// ApplyPOSCompletion stores that decision.
//
// A moved-out row keeps its pos_order_id (and status) but is marked with
// pos_moved_out_at and unlinked from the bill: it is no longer a line of X,
// so X's bill, native-line diff and cancellation leave it alone. When Y
// completes it is adopted: pos_order_id becomes Y, pos_origin_order_id
// remembers X, and it is completed on Y's bill.

// POSRow is one payment_orders row as the completion planner sees it.
type POSRow struct {
	ID           string
	POSOrderID   string
	MenuItemName string
	CategoryName string
	Status       string
	Amount       int64
	CreatedAt    time.Time
	MovedOutAt   time.Time // zero when not moved out
}

const posRowColumns = `id, COALESCE(pos_order_id, ''), menu_item_name, category_name, status, amount, created_at, pos_moved_out_at`

// ListPOSRowsOnOrder returns every row whose pos_order_id = posOrderID (any
// status, moved out or not), oldest first.
func (r *Repository) ListPOSRowsOnOrder(ctx context.Context, posOrderID string) ([]POSRow, error) {
	return queryPOSRows(ctx, r.pool, `
		SELECT `+posRowColumns+`
		FROM payment_orders
		WHERE pos_order_id = $1
		ORDER BY created_at, id
	`, strings.TrimSpace(posOrderID))
}

// ListPOSMoveCandidates returns the rows that may have moved into
// posOrderID: still unpaid (READY/ACKNOWLEDGED), on another POS order, and
// created in [from, to), oldest first.
func (r *Repository) ListPOSMoveCandidates(ctx context.Context, posOrderID string, from, to time.Time) ([]POSRow, error) {
	return queryPOSRows(ctx, r.pool, `
		SELECT `+posRowColumns+`
		FROM payment_orders
		WHERE status IN ('READY', 'ACKNOWLEDGED')
			AND pos_order_id IS NOT NULL
			AND pos_order_id <> $1
			AND created_at >= $2 AND created_at < $3
		ORDER BY created_at, id
	`, strings.TrimSpace(posOrderID), from, to)
}

func queryPOSRows(ctx context.Context, q tableQuerier, sql string, args ...any) ([]POSRow, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, classifyError(err)
	}
	defer rows.Close()
	out := make([]POSRow, 0)
	for rows.Next() {
		var row POSRow
		var movedOutAt *time.Time
		if err := rows.Scan(&row.ID, &row.POSOrderID, &row.MenuItemName, &row.CategoryName,
			&row.Status, &row.Amount, &row.CreatedAt, &movedOutAt); err != nil {
			return nil, err
		}
		if movedOutAt != nil {
			row.MovedOutAt = *movedOutAt
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

type ApplyPOSCompletionInput struct {
	POSOrderID     string
	CompletedAt    time.Time
	CompleteRowIDs []string
	MoveOutRowIDs  []string
	AdoptRowIDs    []string
	Natives        []CreatePOSNativeOrderInput // POSOrderID field is set by ApplyPOSCompletion
	TotalAmount    *int64                      // POS charge; nil = unknown (leave as is)
	DiscountAmount *int64
}

// posCompletionLockAttempts bounds how often ApplyPOSCompletion restarts
// because an adopted row changed POS order between reading and locking.
const posCompletionLockAttempts = 5

// ApplyPOSCompletion applies a completion plan for one POS order in ONE
// transaction and returns its bill id.
//
// It holds the advisory lock of the POS order and of every POS order an
// adopted row currently sits on, taken in sorted order so two completions
// adopting from each other cannot deadlock. Rows are re-read under those
// locks; if an adopted row moved to a POS order not locked yet, the
// transaction is rolled back and retried with the larger lock set.
//
//   - CompleteRowIDs: READY/ACKNOWLEDGED rows on the order become DONE.
//     DONE rows are untouched, CANCELLED rows never resurrected.
//   - MoveOutRowIDs: READY/ACKNOWLEDGED rows on the order are marked moved
//     out and unlinked from its bill; status and pos_order_id stay.
//   - AdoptRowIDs: READY/ACKNOWLEDGED rows on any other POS order move onto
//     this one (remembering where they came from) and become DONE. A row
//     already DONE or CANCELLED elsewhere is skipped.
//   - Natives: recorded like CreatePOSNativeOrder, except lines already
//     recorded on the order (DONE rows not named in CompleteRowIDs or
//     AdoptRowIDs, matched by name, category and amount) are not recorded
//     twice. Nothing is recorded on a CANCELLED bill.
//
// Re-applying the same input changes nothing.
func (r *Repository) ApplyPOSCompletion(ctx context.Context, in ApplyPOSCompletionInput) (string, error) {
	posOrderID := strings.TrimSpace(in.POSOrderID)
	if posOrderID == "" {
		return "", ErrInvalidInput
	}
	for _, native := range in.Natives {
		if native.Amount <= 0 {
			return "", ErrInvalidInput
		}
	}
	in.POSOrderID = posOrderID

	locks := []string{posOrderID}
	for attempt := 0; attempt < posCompletionLockAttempts; attempt++ {
		billID, unlocked, err := r.applyPOSCompletion(ctx, in, locks)
		if err != nil {
			return "", err
		}
		if len(unlocked) == 0 {
			return billID, nil
		}
		locks = uniqueIDs(append(locks, unlocked...))
	}
	return "", errors.New("store: POS orders of adopted rows kept changing")
}

// applyPOSCompletion runs one attempt holding the locks of the given POS
// orders. When an adopted row sits on a POS order outside that set it
// rolls back and returns those POS orders instead.
func (r *Repository) applyPOSCompletion(ctx context.Context, in ApplyPOSCompletionInput, locks []string) (string, []string, error) {
	posOrderID := in.POSOrderID
	completeIDs := uniqueIDs(in.CompleteRowIDs)
	moveOutIDs := uniqueIDs(in.MoveOutRowIDs)
	adoptIDs := uniqueIDs(in.AdoptRowIDs)
	settledIDs := uniqueIDs(append(append([]string{}, completeIDs...), adoptIDs...))

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", nil, err
	}
	defer tx.Rollback(ctx)
	for _, id := range uniqueIDs(locks) {
		if err := lockPOSOrder(ctx, tx, id); err != nil {
			return "", nil, err
		}
	}

	origins, err := queryStrings(ctx, tx, `
		SELECT DISTINCT pos_order_id FROM payment_orders
		WHERE id = ANY($1) AND status IN ('READY', 'ACKNOWLEDGED') AND pos_order_id IS NOT NULL
	`, adoptIDs)
	if err != nil {
		return "", nil, err
	}
	unlocked := make([]string, 0)
	for _, origin := range origins {
		if !containsString(locks, origin) {
			unlocked = append(unlocked, origin)
		}
	}
	if len(unlocked) > 0 {
		return "", unlocked, nil
	}

	billID, err := ensurePOSBill(ctx, tx, posOrderID)
	if err != nil {
		return "", nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE payment_orders
		SET pos_moved_out_at = COALESCE(pos_moved_out_at, NOW()), bill_id = NULL, updated_at = NOW()
		WHERE id = ANY($1) AND pos_order_id = $2 AND status IN ('READY', 'ACKNOWLEDGED')
			AND (pos_moved_out_at IS NULL OR bill_id IS NOT NULL)
	`, moveOutIDs, posOrderID); err != nil {
		return "", nil, classifyError(err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE payment_orders
		SET pos_origin_order_id = COALESCE(pos_origin_order_id, pos_order_id),
			pos_order_id = $2,
			bill_id = $3,
			pos_moved_out_at = NULL,
			updated_at = NOW()
		WHERE id = ANY($1) AND status IN ('READY', 'ACKNOWLEDGED') AND pos_order_id IS DISTINCT FROM $2
	`, adoptIDs, posOrderID, billID); err != nil {
		return "", nil, classifyError(err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE payment_orders
		SET status = 'DONE',
			payment_method = 'POS',
			approved_at = $3,
			vat = amount / 11,
			supplied_amount = amount - amount / 11,
			tax_free_amount = 0,
			bill_id = $4,
			pos_moved_out_at = NULL,
			updated_at = NOW()
		WHERE id = ANY($1) AND pos_order_id = $2 AND status IN ('READY', 'ACKNOWLEDGED')
	`, settledIDs, posOrderID, in.CompletedAt, billID); err != nil {
		return "", nil, classifyError(err)
	}

	if err := insertMissingPOSNatives(ctx, tx, posOrderID, billID, settledIDs, in.Natives); err != nil {
		return "", nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE pos_bills
		SET status = CASE
				WHEN status = 'CANCELLED' THEN 'CANCELLED'
				WHEN EXISTS (SELECT 1 FROM payment_orders WHERE bill_id = $1)
					AND NOT EXISTS (SELECT 1 FROM payment_orders WHERE bill_id = $1 AND status <> 'CANCELLED')
				THEN 'CANCELLED'
				ELSE 'PAID'
			END,
			completed_at = COALESCE(completed_at, $2),
			total_amount = COALESCE($3::BIGINT, total_amount),
			discount_amount = COALESCE($4::BIGINT, discount_amount),
			payment_sync_attempted_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
	`, billID, in.CompletedAt, in.TotalAmount, in.DiscountAmount); err != nil {
		return "", nil, classifyError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", nil, err
	}
	return billID, nil, nil
}

// insertMissingPOSNatives records the natives not already recorded on the
// POS order. Rows the plan settles (settledIDs) are web rows, not earlier
// natives, so they are not matched.
func insertMissingPOSNatives(ctx context.Context, q tableQuerier, posOrderID string, billID string, settledIDs []string, natives []CreatePOSNativeOrderInput) error {
	if len(natives) == 0 {
		return nil
	}
	var cancelled bool
	if err := q.QueryRow(ctx, `SELECT status = 'CANCELLED' FROM pos_bills WHERE id = $1`, billID).Scan(&cancelled); err != nil {
		return classifyError(err)
	}
	if cancelled {
		return nil
	}
	rows, err := q.Query(ctx, `
		SELECT menu_item_name, category_name, amount
		FROM payment_orders
		WHERE pos_order_id = $1 AND pos_moved_out_at IS NULL AND status = 'DONE' AND id <> ALL($2)
	`, posOrderID, settledIDs)
	if err != nil {
		return classifyError(err)
	}
	type lineKey struct {
		name, category string
		amount         int64
	}
	recorded := make(map[lineKey]int)
	for rows.Next() {
		var key lineKey
		if err := rows.Scan(&key.name, &key.category, &key.amount); err != nil {
			rows.Close()
			return err
		}
		recorded[key]++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return classifyError(err)
	}

	for _, native := range natives {
		key := lineKey{native.MenuItemName, native.CategoryName, native.Amount}
		if recorded[key] > 0 {
			recorded[key]--
			continue
		}
		native.POSOrderID = posOrderID
		if err := insertPOSNativeOrder(ctx, q, nextID("order"), native); err != nil {
			return err
		}
	}
	return nil
}

func queryStrings(ctx context.Context, q tableQuerier, sql string, args ...any) ([]string, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, classifyError(err)
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		out = append(out, value)
	}
	return out, rows.Err()
}

// uniqueIDs trims, drops empty and duplicate ids and sorts the rest. The
// result is never nil, so it binds as an empty array rather than NULL.
func uniqueIDs(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" && !containsString(out, id) {
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out
}

func containsString(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
