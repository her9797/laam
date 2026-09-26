package store

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/her9797/laam/laam-api/internal/lamdata"
	"github.com/jackc/pgx/v5"
)

// posBillMenuPreviewSize is how many menu names each bill-list row carries.
const posBillMenuPreviewSize = 3

// POSBillFilter is the parsed, validated filter/page input for
// ListPOSBillsPage.
type POSBillFilter struct {
	Status     string     // "" = all | "OPEN" | "PAID" | "CANCELLED"
	SourceType string     // "" = all | a pos_payments.source_type with an APPROVED payment on the bill
	Search     string     // matched against table_number
	From       *time.Time // opened_at, inclusive
	To         *time.Time // opened_at, exclusive
	Page       int
	PageSize   int
}

// posBillAmountColumns computes a bill's total and paid amounts for the
// pos_bills row aliased b: the POS charge when recorded (else the sum of
// its non-cancelled menu rows), and the sum of its APPROVED payments.
const posBillAmountColumns = `
	COALESCE(b.total_amount, (
		SELECT COALESCE(SUM(o.amount), 0) FROM payment_orders o
		WHERE o.bill_id = b.id AND o.status <> 'CANCELLED'
	)),
	(
		SELECT COALESCE(SUM(p.amount), 0) FROM pos_payments p
		WHERE p.bill_id = b.id AND p.state = 'APPROVED'
	)
`

func posBillFilterWhereClause(filter POSBillFilter) (string, []any) {
	var b listWhereBuilder
	if filter.Status != "" {
		b.add("b.status = " + b.bind(filter.Status))
	}
	if filter.SourceType != "" {
		b.add(`EXISTS (
			SELECT 1 FROM pos_payments p
			WHERE p.bill_id = b.id AND p.state = 'APPROVED' AND p.source_type = ` + b.bind(filter.SourceType) + `
		)`)
	}
	if filter.From != nil {
		b.add("b.opened_at >= " + b.bind(*filter.From))
	}
	if filter.To != nil {
		b.add("b.opened_at < " + b.bind(*filter.To))
	}
	if pattern := searchPatternOrEmpty(filter.Search); pattern != "" {
		b.add("b.table_number ILIKE " + b.bind(pattern) + ` ESCAPE '\'`)
	}
	return b.clause()
}

// ListPOSBillsPage lists bills for the admin bill screen, newest opened
// first, with the total matching count. Each row carries its payments in
// summary form and a short preview of its menu names.
func (r *Repository) ListPOSBillsPage(ctx context.Context, filter POSBillFilter) ([]lamdata.POSBill, int, error) {
	page := clampListPage(filter.Page)
	pageSize := clampListPageSize(filter.PageSize)
	where, whereArgs := posBillFilterWhereClause(filter)

	// One snapshot for the count, the page and its payments, so paidAmount
	// always agrees with the payments listed next to it.
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx)

	var total int
	if err := tx.QueryRow(ctx, "SELECT COUNT(*) FROM pos_bills b"+where, whereArgs...).Scan(&total); err != nil {
		return nil, 0, classifyError(err)
	}

	listArgs, limitOffset := listPageArgs(whereArgs, pageSize, (page-1)*pageSize)
	rows, err := tx.Query(ctx, `
		SELECT
			b.id,
			b.pos_order_id,
			b.table_number,
			b.status,
			b.opened_at,
			b.completed_at,
			b.cancelled_at,
			`+posBillAmountColumns+`,
			(SELECT COUNT(*) FROM payment_orders o WHERE o.bill_id = b.id),
			ARRAY(
				SELECT o.menu_item_name FROM payment_orders o
				WHERE o.bill_id = b.id
				ORDER BY o.created_at, o.id
				LIMIT `+strconv.Itoa(posBillMenuPreviewSize)+`
			)
		FROM pos_bills b
	`+where+`
		ORDER BY b.opened_at DESC, b.id DESC
		`+limitOffset, listArgs...)
	if err != nil {
		return nil, 0, classifyError(err)
	}
	bills := make([]lamdata.POSBill, 0)
	index := make(map[string]int)
	for rows.Next() {
		var bill lamdata.POSBill
		var openedAt time.Time
		var completedAt, cancelledAt *time.Time
		if err := rows.Scan(
			&bill.ID,
			&bill.POSOrderID,
			&bill.TableNumber,
			&bill.Status,
			&openedAt,
			&completedAt,
			&cancelledAt,
			&bill.TotalAmount,
			&bill.PaidAmount,
			&bill.MenuCount,
			&bill.MenuPreview,
		); err != nil {
			rows.Close()
			return nil, 0, err
		}
		bill.OpenedAt = formatTimestamp(openedAt)
		bill.CompletedAt = formatPOSBillTimestamp(completedAt)
		bill.CancelledAt = formatPOSBillTimestamp(cancelledAt)
		bill.Payments = make([]lamdata.POSBillPaymentSummary, 0)
		if bill.MenuPreview == nil {
			bill.MenuPreview = make([]string, 0)
		}
		index[bill.ID] = len(bills)
		bills = append(bills, bill)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	if len(bills) > 0 {
		billIDs := make([]string, 0, len(bills))
		for _, bill := range bills {
			billIDs = append(billIDs, bill.ID)
		}
		paymentRows, err := tx.Query(ctx, `
			SELECT bill_id, source_type, payment_method, amount, state
			FROM pos_payments
			WHERE bill_id = ANY($1)
			ORDER BY approved_at NULLS LAST, created_at, id
		`, billIDs)
		if err != nil {
			return nil, 0, classifyError(err)
		}
		for paymentRows.Next() {
			var billID string
			var payment lamdata.POSBillPaymentSummary
			if err := paymentRows.Scan(&billID, &payment.SourceType, &payment.PaymentMethod, &payment.Amount, &payment.State); err != nil {
				paymentRows.Close()
				return nil, 0, err
			}
			i := index[billID]
			bills[i].Payments = append(bills[i].Payments, payment)
		}
		paymentRows.Close()
		if err := paymentRows.Err(); err != nil {
			return nil, 0, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, 0, err
	}
	return bills, total, nil
}

// GetPOSBillForAdmin returns one bill with every payment and menu row on
// it. Returns ErrNotFound when no bill has billID.
func (r *Repository) GetPOSBillForAdmin(ctx context.Context, billID string) (lamdata.POSBillDetail, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return lamdata.POSBillDetail{}, err
	}
	defer tx.Rollback(ctx)

	var bill lamdata.POSBillDetail
	var openedAt time.Time
	var completedAt, cancelledAt, syncedAt *time.Time
	if err := tx.QueryRow(ctx, `
		SELECT
			b.id,
			b.pos_order_id,
			b.table_number,
			b.status,
			b.opened_at,
			b.completed_at,
			b.cancelled_at,
			b.discount_amount,
			b.payments_synced_at,
			`+posBillAmountColumns+`
		FROM pos_bills b
		WHERE b.id = $1
	`, strings.TrimSpace(billID)).Scan(
		&bill.ID,
		&bill.POSOrderID,
		&bill.TableNumber,
		&bill.Status,
		&openedAt,
		&completedAt,
		&cancelledAt,
		&bill.DiscountAmount,
		&syncedAt,
		&bill.TotalAmount,
		&bill.PaidAmount,
	); err != nil {
		return lamdata.POSBillDetail{}, classifyError(err)
	}
	bill.OpenedAt = formatTimestamp(openedAt)
	bill.CompletedAt = formatPOSBillTimestamp(completedAt)
	bill.CancelledAt = formatPOSBillTimestamp(cancelledAt)
	bill.PaymentsSyncedAt = formatPOSBillTimestamp(syncedAt)

	payments, err := listPOSBillPayments(ctx, tx, bill.ID)
	if err != nil {
		return lamdata.POSBillDetail{}, err
	}
	bill.Payments = payments

	menuItems, err := listPOSBillMenuItems(ctx, tx, bill.ID)
	if err != nil {
		return lamdata.POSBillDetail{}, err
	}
	bill.MenuItems = menuItems

	if err := tx.Commit(ctx); err != nil {
		return lamdata.POSBillDetail{}, err
	}
	return bill, nil
}

func listPOSBillPayments(ctx context.Context, tx pgx.Tx, billID string) ([]lamdata.POSPayment, error) {
	rows, err := tx.Query(ctx, `
		SELECT
			id, state, source_type, payment_method, card_brand, amount,
			tax_amount, supply_amount, tax_exempt_amount, approved_no, approved_at, cancelled_at
		FROM pos_payments
		WHERE bill_id = $1
		ORDER BY approved_at NULLS LAST, created_at, id
	`, billID)
	if err != nil {
		return nil, classifyError(err)
	}
	defer rows.Close()
	payments := make([]lamdata.POSPayment, 0)
	for rows.Next() {
		var payment lamdata.POSPayment
		var approvedAt, cancelledAt *time.Time
		if err := rows.Scan(
			&payment.ID,
			&payment.State,
			&payment.SourceType,
			&payment.PaymentMethod,
			&payment.CardBrand,
			&payment.Amount,
			&payment.TaxAmount,
			&payment.SupplyAmount,
			&payment.TaxExemptAmount,
			&payment.ApprovedNo,
			&approvedAt,
			&cancelledAt,
		); err != nil {
			return nil, err
		}
		payment.ApprovedAt = formatPOSBillTimestamp(approvedAt)
		payment.CancelledAt = formatPOSBillTimestamp(cancelledAt)
		payments = append(payments, payment)
	}
	return payments, rows.Err()
}

// listPOSBillMenuItems returns the bill's payment_orders rows in the same
// admin read shape (and columns) as GetPaymentOrderForAdmin.
func listPOSBillMenuItems(ctx context.Context, tx pgx.Tx, billID string) ([]lamdata.PaymentOrder, error) {
	rows, err := tx.Query(ctx, `
		SELECT
			id,
			COALESCE(menu_item_id, ''),
			menu_item_name,
			category_name,
			table_number,
			request_note,
			amount,
			vat,
			supplied_amount,
			tax_free_amount,
			status,
			COALESCE(payment_method, ''),
			COALESCE(payment_key, ''),
			approved_at,
			pos_sync_status,
			COALESCE(pos_order_id, ''),
			COALESCE(pos_sync_error, ''),
			created_at
		FROM payment_orders
		WHERE bill_id = $1
		ORDER BY created_at, id
	`, billID)
	if err != nil {
		return nil, classifyError(err)
	}
	defer rows.Close()
	items := make([]lamdata.PaymentOrder, 0)
	for rows.Next() {
		var item lamdata.PaymentOrder
		var approvedAt *time.Time
		var createdAt time.Time
		if err := rows.Scan(
			&item.OrderID,
			&item.MenuItemID,
			&item.MenuItemName,
			&item.CategoryName,
			&item.TableNumber,
			&item.RequestNote,
			&item.Amount,
			&item.VAT,
			&item.SuppliedAmount,
			&item.TaxFreeAmount,
			&item.Status,
			&item.PaymentMethod,
			&item.PaymentKey,
			&approvedAt,
			&item.POSSyncStatus,
			&item.POSOrderID,
			&item.POSSyncError,
			&createdAt,
		); err != nil {
			return nil, err
		}
		item.ApprovedAt = formatPOSBillTimestamp(approvedAt)
		item.CreatedAt = formatTimestamp(createdAt)
		items = append(items, item)
	}
	return items, rows.Err()
}

func formatPOSBillTimestamp(value *time.Time) string {
	if value == nil {
		return ""
	}
	return formatTimestamp(*value)
}
