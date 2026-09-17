package store

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/her9797/laam/laam-api/internal/lamdata"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	expenseCategoryNameMaxLen   = 50
	inventoryItemNameMaxLen     = 100
	inventoryItemUnitMaxLen     = 20
	expenseReceiptVendorMaxLen  = 100
	expenseReceiptMemoMaxLen    = 500
	expenseReceiptLineDescMax   = 200
	expenseReceiptMaxLines      = 100
	inventoryAdjustmentMaxLimit = 200

	// maxInventoryQuantity keeps every stored quantity and delta far inside
	// the INTEGER column range, so a single request can never overflow it.
	maxInventoryQuantity = 1_000_000_000
	// maxExpenseLineAmount bounds a line amount (KRW) so a receipt total of
	// up to expenseReceiptMaxLines lines always fits in BIGINT.
	maxExpenseLineAmount int64 = 1_000_000_000_000
)

const (
	adjustmentReasonPurchase      = "purchase"
	adjustmentReasonReceiptEdit   = "receipt_edit"
	adjustmentReasonReceiptDelete = "receipt_delete"
	adjustmentReasonManual        = "manual"
)

type CreateInventoryItemInput struct {
	Name        string
	CategoryID  string
	Unit        string
	Quantity    int
	MinQuantity int
}

type UpdateInventoryItemInput struct {
	Name        *string
	CategoryID  *string
	Unit        *string
	MinQuantity *int
	IsArchived  *bool
}

// AdjustInventoryItemInput carries exactly one of Delta or Set.
type AdjustInventoryItemInput struct {
	Delta *int
	Set   *int
}

// ExpenseReceiptLineInput is an item line when ItemID is set (Quantity
// required, category taken from the item) and an other-expense line
// otherwise (CategoryID and Description required).
type ExpenseReceiptLineInput struct {
	ItemID      string
	Quantity    *int
	CategoryID  string
	Description string
	Amount      int64
}

type ExpenseReceiptInput struct {
	Date          string
	Vendor        string
	PaymentMethod string
	Memo          string
	Lines         []ExpenseReceiptLineInput
}

// expenseQuerier is satisfied by both *pgxpool.Pool and pgx.Tx.
type expenseQuerier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func invalidInput(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, fmt.Sprintf(format, args...))
}

// classifyExpenseError additionally maps foreign key (23503), check (23514)
// and numeric range (22003) violations to ErrInvalidInput, since they only
// arise from request values here.
func classifyExpenseError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503", "23514", "22003":
			return fmt.Errorf("%w: %s", ErrInvalidInput, pgErr.Message)
		}
	}
	return classifyError(err)
}

// Categories

func (r *Repository) ListExpenseCategories(ctx context.Context) ([]lamdata.ExpenseCategory, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, name, sort_order, is_default FROM expense_categories ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	categories := []lamdata.ExpenseCategory{}
	for rows.Next() {
		var category lamdata.ExpenseCategory
		if err := rows.Scan(&category.ID, &category.Name, &category.SortOrder, &category.IsDefault); err != nil {
			return nil, err
		}
		categories = append(categories, category)
	}
	return categories, rows.Err()
}

func normalizeExpenseCategoryName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > expenseCategoryNameMaxLen {
		return "", invalidInput("name must be 1-%d characters", expenseCategoryNameMaxLen)
	}
	return name, nil
}

func (r *Repository) CreateExpenseCategory(ctx context.Context, name string) (lamdata.ExpenseCategory, error) {
	name, err := normalizeExpenseCategoryName(name)
	if err != nil {
		return lamdata.ExpenseCategory{}, err
	}

	var category lamdata.ExpenseCategory
	err = r.pool.QueryRow(ctx, `
		INSERT INTO expense_categories (id, name, sort_order, is_default)
		SELECT $1, $2, COALESCE(MAX(sort_order), 0) + 1, FALSE FROM expense_categories
		RETURNING id, name, sort_order, is_default
	`, nextID("expcat"), name).Scan(&category.ID, &category.Name, &category.SortOrder, &category.IsDefault)
	if err != nil {
		return lamdata.ExpenseCategory{}, classifyExpenseError(err)
	}
	return category, nil
}

func (r *Repository) UpdateExpenseCategory(ctx context.Context, id string, name string) (lamdata.ExpenseCategory, error) {
	name, err := normalizeExpenseCategoryName(name)
	if err != nil {
		return lamdata.ExpenseCategory{}, err
	}

	var category lamdata.ExpenseCategory
	err = r.pool.QueryRow(ctx, `
		UPDATE expense_categories SET name = $2 WHERE id = $1
		RETURNING id, name, sort_order, is_default
	`, id, name).Scan(&category.ID, &category.Name, &category.SortOrder, &category.IsDefault)
	if err != nil {
		return lamdata.ExpenseCategory{}, classifyExpenseError(err)
	}
	return category, nil
}

// Inventory items

const inventoryItemSelect = `
	SELECT i.id, i.name, i.category_id, i.unit, i.quantity, i.min_quantity, i.is_archived, i.updated_at,
	  last_line.unit_price, last_line.purchased_at
	FROM inventory_items i
	JOIN expense_categories c ON c.id = i.category_id
	LEFT JOIN LATERAL (
	  SELECT ROUND(l.amount::numeric / l.quantity)::bigint AS unit_price, rc.created_at AS purchased_at
	  FROM expense_receipt_lines l
	  JOIN expense_receipts rc ON rc.id = l.receipt_id
	  WHERE l.item_id = i.id AND l.quantity > 0
	  ORDER BY rc.date DESC, rc.created_at DESC, l.line_order DESC
	  LIMIT 1
	) last_line ON TRUE
`

func scanInventoryItem(row pgx.Row) (lamdata.InventoryItem, error) {
	var item lamdata.InventoryItem
	var updatedAt time.Time
	var lastPurchasedAt *time.Time
	if err := row.Scan(&item.ID, &item.Name, &item.CategoryID, &item.Unit, &item.Quantity, &item.MinQuantity, &item.IsArchived, &updatedAt, &item.LastUnitPrice, &lastPurchasedAt); err != nil {
		return lamdata.InventoryItem{}, err
	}
	if lastPurchasedAt != nil {
		formatted := formatTimestamp(*lastPurchasedAt)
		item.LastPurchasedAt = &formatted
	}
	item.NeedsReorder = !item.IsArchived && item.Quantity < item.MinQuantity
	item.NeedsCheck = item.Quantity < 0
	item.UpdatedAt = formatTimestamp(updatedAt)
	return item, nil
}

func (r *Repository) ListInventoryItems(ctx context.Context, includeArchived bool) ([]lamdata.InventoryItem, error) {
	rows, err := r.pool.Query(ctx, inventoryItemSelect+`
		WHERE $1 OR NOT i.is_archived
		ORDER BY (NOT i.is_archived AND i.quantity < i.min_quantity) DESC, c.sort_order, lower(i.name), i.id
	`, includeArchived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []lamdata.InventoryItem{}
	for rows.Next() {
		item, err := scanInventoryItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repository) GetInventoryItem(ctx context.Context, id string) (lamdata.InventoryItem, error) {
	return getInventoryItem(ctx, r.pool, id)
}

func getInventoryItem(ctx context.Context, q expenseQuerier, id string) (lamdata.InventoryItem, error) {
	item, err := scanInventoryItem(q.QueryRow(ctx, inventoryItemSelect+` WHERE i.id = $1`, id))
	if err != nil {
		return lamdata.InventoryItem{}, classifyError(err)
	}
	return item, nil
}

func normalizeInventoryItemName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > inventoryItemNameMaxLen {
		return "", invalidInput("name must be 1-%d characters", inventoryItemNameMaxLen)
	}
	return name, nil
}

func normalizeInventoryItemUnit(unit string) (string, error) {
	unit = strings.TrimSpace(unit)
	if utf8.RuneCountInString(unit) > inventoryItemUnitMaxLen {
		return "", invalidInput("unit must be at most %d characters", inventoryItemUnitMaxLen)
	}
	return unit, nil
}

func validateInventoryQuantity(field string, value int) error {
	if value < 0 || value > maxInventoryQuantity {
		return invalidInput("%s must be between 0 and %d", field, maxInventoryQuantity)
	}
	return nil
}

func expenseCategoryExists(ctx context.Context, q expenseQuerier, id string) error {
	var exists bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM expense_categories WHERE id = $1)`, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return invalidInput("unknown categoryId %q", id)
	}
	return nil
}

func (r *Repository) CreateInventoryItem(ctx context.Context, input CreateInventoryItemInput) (lamdata.InventoryItem, error) {
	name, err := normalizeInventoryItemName(input.Name)
	if err != nil {
		return lamdata.InventoryItem{}, err
	}
	unit, err := normalizeInventoryItemUnit(input.Unit)
	if err != nil {
		return lamdata.InventoryItem{}, err
	}
	if err := validateInventoryQuantity("quantity", input.Quantity); err != nil {
		return lamdata.InventoryItem{}, err
	}
	if err := validateInventoryQuantity("minQuantity", input.MinQuantity); err != nil {
		return lamdata.InventoryItem{}, err
	}
	categoryID := strings.TrimSpace(input.CategoryID)
	if err := expenseCategoryExists(ctx, r.pool, categoryID); err != nil {
		return lamdata.InventoryItem{}, err
	}

	id := nextID("item")
	if _, err := r.pool.Exec(ctx, `
		INSERT INTO inventory_items (id, name, category_id, unit, quantity, min_quantity)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, name, categoryID, unit, input.Quantity, input.MinQuantity); err != nil {
		return lamdata.InventoryItem{}, classifyExpenseError(err)
	}
	return r.GetInventoryItem(ctx, id)
}

func (r *Repository) UpdateInventoryItem(ctx context.Context, id string, input UpdateInventoryItemInput) (lamdata.InventoryItem, error) {
	var sets []string
	args := []any{id}
	bind := func(column string, value any) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = $%d", column, len(args)))
	}

	if input.Name != nil {
		name, err := normalizeInventoryItemName(*input.Name)
		if err != nil {
			return lamdata.InventoryItem{}, err
		}
		bind("name", name)
	}
	if input.CategoryID != nil {
		categoryID := strings.TrimSpace(*input.CategoryID)
		if err := expenseCategoryExists(ctx, r.pool, categoryID); err != nil {
			return lamdata.InventoryItem{}, err
		}
		bind("category_id", categoryID)
	}
	if input.Unit != nil {
		unit, err := normalizeInventoryItemUnit(*input.Unit)
		if err != nil {
			return lamdata.InventoryItem{}, err
		}
		bind("unit", unit)
	}
	if input.MinQuantity != nil {
		if err := validateInventoryQuantity("minQuantity", *input.MinQuantity); err != nil {
			return lamdata.InventoryItem{}, err
		}
		bind("min_quantity", *input.MinQuantity)
	}
	if input.IsArchived != nil {
		bind("is_archived", *input.IsArchived)
	}

	if len(sets) > 0 {
		tag, err := r.pool.Exec(ctx, `UPDATE inventory_items SET `+strings.Join(sets, ", ")+`, updated_at = NOW() WHERE id = $1`, args...)
		if err != nil {
			return lamdata.InventoryItem{}, classifyExpenseError(err)
		}
		if tag.RowsAffected() == 0 {
			return lamdata.InventoryItem{}, ErrNotFound
		}
	}
	return r.GetInventoryItem(ctx, id)
}

// applyInventoryDelta atomically adds delta to the item's quantity and
// records the change. The quantity is never read and written back from Go,
// so concurrent adjustments cannot lose updates.
func applyInventoryDelta(ctx context.Context, tx pgx.Tx, itemID string, delta int, reason string, receiptID *string) error {
	var quantityAfter int
	err := tx.QueryRow(ctx, `
		UPDATE inventory_items SET quantity = quantity + $2, updated_at = NOW()
		WHERE id = $1
		RETURNING quantity
	`, itemID, delta).Scan(&quantityAfter)
	if err != nil {
		return classifyExpenseError(err)
	}
	return insertInventoryAdjustment(ctx, tx, itemID, delta, quantityAfter, reason, receiptID)
}

func insertInventoryAdjustment(ctx context.Context, tx pgx.Tx, itemID string, delta int, quantityAfter int, reason string, receiptID *string) error {
	// clock_timestamp keeps several entries written by one transaction in order.
	_, err := tx.Exec(ctx, `
		INSERT INTO inventory_adjustments (id, item_id, delta, quantity_after, reason, receipt_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())
	`, nextID("adj"), itemID, delta, quantityAfter, reason, receiptID)
	return classifyExpenseError(err)
}

func (r *Repository) AdjustInventoryItem(ctx context.Context, id string, input AdjustInventoryItemInput) (lamdata.InventoryItem, error) {
	if (input.Delta == nil) == (input.Set == nil) {
		return lamdata.InventoryItem{}, invalidInput("exactly one of delta or set is required")
	}
	if input.Delta != nil && (*input.Delta > maxInventoryQuantity || *input.Delta < -maxInventoryQuantity) {
		return lamdata.InventoryItem{}, invalidInput("delta out of range")
	}
	if input.Set != nil {
		if err := validateInventoryQuantity("set", *input.Set); err != nil {
			return lamdata.InventoryItem{}, err
		}
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return lamdata.InventoryItem{}, err
	}
	defer tx.Rollback(ctx)

	var delta, quantityAfter int
	if input.Delta != nil {
		delta = *input.Delta
		if delta == 0 {
			return r.GetInventoryItem(ctx, id)
		}
		err := tx.QueryRow(ctx, `
			UPDATE inventory_items SET quantity = quantity + $2, updated_at = NOW()
			WHERE id = $1 AND quantity + $2 >= 0
			RETURNING quantity
		`, id, delta).Scan(&quantityAfter)
		if errors.Is(err, pgx.ErrNoRows) {
			if _, getErr := getInventoryItem(ctx, tx, id); getErr != nil {
				return lamdata.InventoryItem{}, getErr
			}
			return lamdata.InventoryItem{}, invalidInput("quantity cannot go below zero")
		}
		if err != nil {
			return lamdata.InventoryItem{}, classifyExpenseError(err)
		}
	} else {
		var current int
		if err := tx.QueryRow(ctx, `SELECT quantity FROM inventory_items WHERE id = $1 FOR UPDATE`, id).Scan(&current); err != nil {
			return lamdata.InventoryItem{}, classifyError(err)
		}
		delta = *input.Set - current
		if delta == 0 {
			return getInventoryItem(ctx, tx, id)
		}
		if _, err := tx.Exec(ctx, `UPDATE inventory_items SET quantity = $2, updated_at = NOW() WHERE id = $1`, id, *input.Set); err != nil {
			return lamdata.InventoryItem{}, classifyExpenseError(err)
		}
		quantityAfter = *input.Set
	}

	if err := insertInventoryAdjustment(ctx, tx, id, delta, quantityAfter, adjustmentReasonManual, nil); err != nil {
		return lamdata.InventoryItem{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return lamdata.InventoryItem{}, err
	}
	return r.GetInventoryItem(ctx, id)
}

func (r *Repository) ListInventoryAdjustments(ctx context.Context, itemID string, limit int) ([]lamdata.InventoryAdjustment, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > inventoryAdjustmentMaxLimit {
		limit = inventoryAdjustmentMaxLimit
	}

	var exists bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM inventory_items WHERE id = $1)`, itemID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	rows, err := r.pool.Query(ctx, `
		SELECT id, item_id, delta, quantity_after, reason, receipt_id, created_at
		FROM inventory_adjustments
		WHERE item_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2
	`, itemID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	adjustments := []lamdata.InventoryAdjustment{}
	for rows.Next() {
		var adjustment lamdata.InventoryAdjustment
		var createdAt time.Time
		if err := rows.Scan(&adjustment.ID, &adjustment.ItemID, &adjustment.Delta, &adjustment.QuantityAfter, &adjustment.Reason, &adjustment.ReceiptID, &createdAt); err != nil {
			return nil, err
		}
		adjustment.CreatedAt = formatTimestamp(createdAt)
		adjustments = append(adjustments, adjustment)
	}
	return adjustments, rows.Err()
}

func (r *Repository) GetInventorySummary(ctx context.Context) (lamdata.InventorySummary, error) {
	var summary lamdata.InventorySummary
	err := r.pool.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE quantity < min_quantity),
		  COUNT(*) FILTER (WHERE quantity < 0)
		FROM inventory_items
		WHERE NOT is_archived
	`).Scan(&summary.ReorderCount, &summary.NeedsCheckCount)
	return summary, err
}

// Receipts

// expenseMonthRange parses a YYYY-MM calendar month (Asia/Seoul calendar,
// which receipt dates already are) into [start, end) DATE bounds plus the
// previous month's start.
func expenseMonthRange(month string) (start time.Time, end time.Time, previousStart time.Time, err error) {
	parsed, parseErr := time.Parse("2006-01", month)
	if len(month) != len("2006-01") || parseErr != nil {
		return time.Time{}, time.Time{}, time.Time{}, invalidInput("month must be YYYY-MM")
	}
	start = time.Date(parsed.Year(), parsed.Month(), 1, 0, 0, 0, 0, time.UTC)
	return start, start.AddDate(0, 1, 0), start.AddDate(0, -1, 0), nil
}

type validatedReceipt struct {
	date          time.Time
	vendor        string
	paymentMethod string
	memo          string
	lines         []ExpenseReceiptLineInput
	total         int64
}

func validateExpenseReceiptInput(input ExpenseReceiptInput) (validatedReceipt, error) {
	date, err := time.Parse("2006-01-02", input.Date)
	if len(input.Date) != len("2006-01-02") || err != nil {
		return validatedReceipt{}, invalidInput("date must be YYYY-MM-DD")
	}
	receipt := validatedReceipt{
		date:          date,
		vendor:        strings.TrimSpace(input.Vendor),
		paymentMethod: strings.TrimSpace(input.PaymentMethod),
		memo:          strings.TrimSpace(input.Memo),
	}
	switch receipt.paymentMethod {
	case "card", "cash", "transfer":
	default:
		return validatedReceipt{}, invalidInput("paymentMethod must be card, cash or transfer")
	}
	if utf8.RuneCountInString(receipt.vendor) > expenseReceiptVendorMaxLen {
		return validatedReceipt{}, invalidInput("vendor must be at most %d characters", expenseReceiptVendorMaxLen)
	}
	if utf8.RuneCountInString(receipt.memo) > expenseReceiptMemoMaxLen {
		return validatedReceipt{}, invalidInput("memo must be at most %d characters", expenseReceiptMemoMaxLen)
	}
	if len(input.Lines) < 1 || len(input.Lines) > expenseReceiptMaxLines {
		return validatedReceipt{}, invalidInput("lines must contain 1-%d entries", expenseReceiptMaxLines)
	}

	for i, line := range input.Lines {
		if line.Amount < 0 || line.Amount > maxExpenseLineAmount {
			return validatedReceipt{}, invalidInput("lines[%d].amount must be between 0 and %d", i, maxExpenseLineAmount)
		}
		normalized := ExpenseReceiptLineInput{ItemID: strings.TrimSpace(line.ItemID), Amount: line.Amount}
		if normalized.ItemID != "" {
			if line.Quantity == nil || *line.Quantity < 1 || *line.Quantity > maxInventoryQuantity {
				return validatedReceipt{}, invalidInput("lines[%d].quantity must be between 1 and %d", i, maxInventoryQuantity)
			}
			quantity := *line.Quantity
			normalized.Quantity = &quantity
		} else {
			normalized.CategoryID = strings.TrimSpace(line.CategoryID)
			normalized.Description = strings.TrimSpace(line.Description)
			if normalized.Description == "" || utf8.RuneCountInString(normalized.Description) > expenseReceiptLineDescMax {
				return validatedReceipt{}, invalidInput("lines[%d].description must be 1-%d characters", i, expenseReceiptLineDescMax)
			}
			if normalized.CategoryID == "" {
				return validatedReceipt{}, invalidInput("lines[%d].categoryId is required", i)
			}
		}
		receipt.lines = append(receipt.lines, normalized)
		receipt.total += line.Amount
	}
	return receipt, nil
}

type lockedInventoryItem struct {
	name       string
	categoryID string
	isArchived bool
}

// lockInventoryItems row-locks the given items in id order, so concurrent
// receipt writes touching overlapping items always lock in the same order.
func lockInventoryItems(ctx context.Context, tx pgx.Tx, ids []string) (map[string]lockedInventoryItem, error) {
	items := map[string]lockedInventoryItem{}
	if len(ids) == 0 {
		return items, nil
	}
	rows, err := tx.Query(ctx, `
		SELECT id, name, category_id, is_archived FROM inventory_items
		WHERE id = ANY($1)
		ORDER BY id
		FOR UPDATE
	`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var item lockedInventoryItem
		if err := rows.Scan(&id, &item.name, &item.categoryID, &item.isArchived); err != nil {
			return nil, err
		}
		items[id] = item
	}
	return items, rows.Err()
}

// receiptItemQuantities sums item line quantities per item id.
func receiptItemQuantities(ctx context.Context, tx pgx.Tx, receiptID string) (map[string]int, error) {
	rows, err := tx.Query(ctx, `
		SELECT item_id, SUM(quantity)::bigint FROM expense_receipt_lines
		WHERE receipt_id = $1 AND item_id IS NOT NULL
		GROUP BY item_id
	`, receiptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sums := map[string]int{}
	for rows.Next() {
		var itemID string
		var sum int64
		if err := rows.Scan(&itemID, &sum); err != nil {
			return nil, err
		}
		sums[itemID] = int(sum)
	}
	return sums, rows.Err()
}

// writeReceiptLines resolves item and category references, replaces the
// receipt's lines and returns the new per-item quantity sums. Archived items
// are refused unless allowedArchived already had them on this receipt.
func writeReceiptLines(ctx context.Context, tx pgx.Tx, receiptID string, receipt validatedReceipt, items map[string]lockedInventoryItem, allowedArchived map[string]int) (map[string]int, error) {
	type itemSnapshot struct {
		name       string
		categoryID string
	}
	existingSnapshots := map[string]itemSnapshot{}
	rows, err := tx.Query(ctx, `
		SELECT item_id, item_name, category_id
		FROM expense_receipt_lines
		WHERE receipt_id = $1 AND item_id IS NOT NULL
		ORDER BY line_order
	`, receiptID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var itemID, itemName, categoryID string
		if err := rows.Scan(&itemID, &itemName, &categoryID); err != nil {
			rows.Close()
			return nil, err
		}
		if _, exists := existingSnapshots[itemID]; !exists {
			existingSnapshots[itemID] = itemSnapshot{name: itemName, categoryID: categoryID}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var categoryIDs []string
	for _, line := range receipt.lines {
		if line.ItemID == "" {
			categoryIDs = append(categoryIDs, line.CategoryID)
		}
	}
	knownCategories := map[string]bool{}
	if len(categoryIDs) > 0 {
		rows, err := tx.Query(ctx, `SELECT id FROM expense_categories WHERE id = ANY($1)`, categoryIDs)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			knownCategories[id] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM expense_receipt_lines WHERE receipt_id = $1`, receiptID); err != nil {
		return nil, err
	}

	sums := map[string]int{}
	for i, line := range receipt.lines {
		var itemID *string
		var itemName, categoryID string
		if line.ItemID != "" {
			item, ok := items[line.ItemID]
			if !ok {
				return nil, invalidInput("lines[%d].itemId %q not found", i, line.ItemID)
			}
			if _, hadItem := allowedArchived[line.ItemID]; item.isArchived && !hadItem {
				return nil, invalidInput("lines[%d].itemId %q is archived", i, line.ItemID)
			}
			id := line.ItemID
			itemID = &id
			if snapshot, exists := existingSnapshots[line.ItemID]; exists {
				itemName = snapshot.name
				categoryID = snapshot.categoryID
			} else {
				itemName = item.name
				categoryID = item.categoryID
			}
			sums[line.ItemID] += *line.Quantity
		} else {
			if !knownCategories[line.CategoryID] {
				return nil, invalidInput("lines[%d].categoryId %q not found", i, line.CategoryID)
			}
			itemName = line.Description
			categoryID = line.CategoryID
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO expense_receipt_lines (id, receipt_id, line_order, item_id, item_name, category_id, description, quantity, amount)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, nextID("line"), receiptID, i, itemID, itemName, categoryID, line.Description, line.Quantity, line.Amount); err != nil {
			return nil, classifyExpenseError(err)
		}
	}
	return sums, nil
}

func receiptItemIDs(receipt validatedReceipt, extra map[string]int) []string {
	seen := map[string]bool{}
	var ids []string
	add := func(id string) {
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, line := range receipt.lines {
		add(line.ItemID)
	}
	for id := range extra {
		add(id)
	}
	slices.Sort(ids)
	return ids
}

// applyReceiptQuantityChanges applies newSums - oldSums per item in id order.
func applyReceiptQuantityChanges(ctx context.Context, tx pgx.Tx, receiptID string, oldSums map[string]int, newSums map[string]int, reason string) error {
	ids := receiptItemIDs(validatedReceipt{}, oldSums)
	for id := range newSums {
		if _, ok := oldSums[id]; !ok {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	for _, id := range ids {
		delta := newSums[id] - oldSums[id]
		if delta == 0 {
			continue
		}
		if err := applyInventoryDelta(ctx, tx, id, delta, reason, &receiptID); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) CreateExpenseReceipt(ctx context.Context, input ExpenseReceiptInput) (lamdata.ExpenseReceipt, error) {
	receipt, err := validateExpenseReceiptInput(input)
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	defer tx.Rollback(ctx)

	items, err := lockInventoryItems(ctx, tx, receiptItemIDs(receipt, nil))
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}

	id := nextID("receipt")
	if _, err := tx.Exec(ctx, `
		INSERT INTO expense_receipts (id, date, vendor, payment_method, memo, total)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, receipt.date, receipt.vendor, receipt.paymentMethod, receipt.memo, receipt.total); err != nil {
		return lamdata.ExpenseReceipt{}, classifyExpenseError(err)
	}
	newSums, err := writeReceiptLines(ctx, tx, id, receipt, items, nil)
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	if err := applyReceiptQuantityChanges(ctx, tx, id, nil, newSums, adjustmentReasonPurchase); err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	return r.GetExpenseReceipt(ctx, id)
}

func (r *Repository) UpdateExpenseReceipt(ctx context.Context, id string, input ExpenseReceiptInput) (lamdata.ExpenseReceipt, error) {
	receipt, err := validateExpenseReceiptInput(input)
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	defer tx.Rollback(ctx)

	if err := tx.QueryRow(ctx, `SELECT id FROM expense_receipts WHERE id = $1 FOR UPDATE`, id).Scan(&id); err != nil {
		return lamdata.ExpenseReceipt{}, classifyError(err)
	}
	oldSums, err := receiptItemQuantities(ctx, tx, id)
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	items, err := lockInventoryItems(ctx, tx, receiptItemIDs(receipt, oldSums))
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE expense_receipts
		SET date = $2, vendor = $3, payment_method = $4, memo = $5, total = $6, updated_at = NOW()
		WHERE id = $1
	`, id, receipt.date, receipt.vendor, receipt.paymentMethod, receipt.memo, receipt.total); err != nil {
		return lamdata.ExpenseReceipt{}, classifyExpenseError(err)
	}
	newSums, err := writeReceiptLines(ctx, tx, id, receipt, items, oldSums)
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	if err := applyReceiptQuantityChanges(ctx, tx, id, oldSums, newSums, adjustmentReasonReceiptEdit); err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	return r.GetExpenseReceipt(ctx, id)
}

// DeleteExpenseReceipt removes the receipt, subtracts its item quantities
// (the result may go negative) and returns its stored image path, if any,
// for the caller to remove from object storage.
func (r *Repository) DeleteExpenseReceipt(ctx context.Context, id string) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var imagePath string
	if err := tx.QueryRow(ctx, `SELECT COALESCE(image_path, '') FROM expense_receipts WHERE id = $1 FOR UPDATE`, id).Scan(&imagePath); err != nil {
		return "", classifyError(err)
	}
	oldSums, err := receiptItemQuantities(ctx, tx, id)
	if err != nil {
		return "", err
	}
	if _, err := lockInventoryItems(ctx, tx, receiptItemIDs(validatedReceipt{}, oldSums)); err != nil {
		return "", err
	}
	if err := applyReceiptQuantityChanges(ctx, tx, id, oldSums, nil, adjustmentReasonReceiptDelete); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM expense_receipts WHERE id = $1`, id); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return imagePath, nil
}

func (r *Repository) ListExpenseReceipts(ctx context.Context, month string, categoryID string) ([]lamdata.ExpenseReceipt, error) {
	start, end, _, err := expenseMonthRange(month)
	if err != nil {
		return nil, err
	}
	where := `WHERE r.date >= $1 AND r.date < $2`
	args := []any{start, end}
	if categoryID = strings.TrimSpace(categoryID); categoryID != "" {
		args = append(args, categoryID)
		where += ` AND EXISTS (SELECT 1 FROM expense_receipt_lines l WHERE l.receipt_id = r.id AND l.category_id = $3)`
	}
	return listExpenseReceipts(ctx, r.pool, where, args...)
}

func (r *Repository) GetExpenseReceipt(ctx context.Context, id string) (lamdata.ExpenseReceipt, error) {
	receipts, err := listExpenseReceipts(ctx, r.pool, `WHERE r.id = $1`, id)
	if err != nil {
		return lamdata.ExpenseReceipt{}, err
	}
	if len(receipts) == 0 {
		return lamdata.ExpenseReceipt{}, ErrNotFound
	}
	return receipts[0], nil
}

func listExpenseReceipts(ctx context.Context, q expenseQuerier, where string, args ...any) ([]lamdata.ExpenseReceipt, error) {
	rows, err := q.Query(ctx, `
		SELECT r.id, to_char(r.date, 'YYYY-MM-DD'), r.vendor, r.payment_method, r.memo, r.total,
		  r.image_path IS NOT NULL, r.created_at, r.updated_at
		FROM expense_receipts r
		`+where+`
		ORDER BY r.date DESC, r.created_at DESC, r.id DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	receipts := []lamdata.ExpenseReceipt{}
	index := map[string]int{}
	var ids []string
	for rows.Next() {
		var receipt lamdata.ExpenseReceipt
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&receipt.ID, &receipt.Date, &receipt.Vendor, &receipt.PaymentMethod, &receipt.Memo, &receipt.Total, &receipt.HasImage, &createdAt, &updatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		receipt.CreatedAt = formatTimestamp(createdAt)
		receipt.UpdatedAt = formatTimestamp(updatedAt)
		receipt.Lines = []lamdata.ExpenseReceiptLine{}
		index[receipt.ID] = len(receipts)
		ids = append(ids, receipt.ID)
		receipts = append(receipts, receipt)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return receipts, nil
	}

	lineRows, err := q.Query(ctx, `
		SELECT id, receipt_id, item_id, item_name, category_id, description, quantity, amount
		FROM expense_receipt_lines
		WHERE receipt_id = ANY($1)
		ORDER BY receipt_id, line_order
	`, ids)
	if err != nil {
		return nil, err
	}
	defer lineRows.Close()
	for lineRows.Next() {
		var line lamdata.ExpenseReceiptLine
		var receiptID string
		if err := lineRows.Scan(&line.ID, &receiptID, &line.ItemID, &line.ItemName, &line.CategoryID, &line.Description, &line.Quantity, &line.Amount); err != nil {
			return nil, err
		}
		receipt := &receipts[index[receiptID]]
		receipt.Lines = append(receipt.Lines, line)
	}
	return receipts, lineRows.Err()
}

func (r *Repository) GetExpenseSummary(ctx context.Context, month string) (lamdata.ExpenseSummary, error) {
	start, end, previousStart, err := expenseMonthRange(month)
	if err != nil {
		return lamdata.ExpenseSummary{}, err
	}

	summary := lamdata.ExpenseSummary{Month: month, ByCategory: []lamdata.ExpenseCategoryAmount{}}
	err = r.pool.QueryRow(ctx, `
		SELECT
		  COALESCE(SUM(total) FILTER (WHERE date >= $1), 0)::bigint,
		  COALESCE(SUM(total) FILTER (WHERE date < $1), 0)::bigint,
		  COUNT(*) FILTER (WHERE date >= $1)
		FROM expense_receipts
		WHERE date >= $3 AND date < $2
	`, start, end, previousStart).Scan(&summary.Total, &summary.PreviousMonthTotal, &summary.ReceiptCount)
	if err != nil {
		return lamdata.ExpenseSummary{}, err
	}

	rows, err := r.pool.Query(ctx, `
		SELECT c.id, c.name, SUM(l.amount)::bigint AS amount
		FROM expense_receipt_lines l
		JOIN expense_receipts r ON r.id = l.receipt_id
		JOIN expense_categories c ON c.id = l.category_id
		WHERE r.date >= $1 AND r.date < $2
		GROUP BY c.id, c.name, c.sort_order
		HAVING SUM(l.amount) > 0
		ORDER BY amount DESC, c.sort_order, c.id
	`, start, end)
	if err != nil {
		return lamdata.ExpenseSummary{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry lamdata.ExpenseCategoryAmount
		if err := rows.Scan(&entry.CategoryID, &entry.Name, &entry.Amount); err != nil {
			return lamdata.ExpenseSummary{}, err
		}
		summary.ByCategory = append(summary.ByCategory, entry)
	}
	return summary, rows.Err()
}

// Receipt image paths

// GetExpenseReceiptImagePath returns the receipt's stored object path, or
// "" when it has no image.
func (r *Repository) GetExpenseReceiptImagePath(ctx context.Context, id string) (string, error) {
	var path string
	if err := r.pool.QueryRow(ctx, `SELECT COALESCE(image_path, '') FROM expense_receipts WHERE id = $1`, id).Scan(&path); err != nil {
		return "", classifyError(err)
	}
	return path, nil
}

// SetExpenseReceiptImagePath stores a new object path and returns the one it
// replaced ("" if none).
func (r *Repository) SetExpenseReceiptImagePath(ctx context.Context, id string, path string) (string, error) {
	var oldPath string
	err := r.pool.QueryRow(ctx, `
		UPDATE expense_receipts r SET image_path = $2, updated_at = NOW()
		FROM (SELECT id, COALESCE(image_path, '') AS old_path FROM expense_receipts WHERE id = $1 FOR UPDATE) old
		WHERE r.id = old.id
		RETURNING old.old_path
	`, id, path).Scan(&oldPath)
	if err != nil {
		return "", classifyError(err)
	}
	return oldPath, nil
}

// ClearExpenseReceiptImagePath clears the image only while it still points
// at expectedPath, so a concurrent replacement is never dropped.
func (r *Repository) ClearExpenseReceiptImagePath(ctx context.Context, id string, expectedPath string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE expense_receipts SET image_path = NULL, updated_at = NOW()
		WHERE id = $1 AND image_path = $2
	`, id, expectedPath)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		if _, err := r.GetExpenseReceiptImagePath(ctx, id); err != nil {
			return err
		}
	}
	return nil
}
