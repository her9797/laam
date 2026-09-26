package main

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/her9797/laam/laam-api/internal/store"
)

// dbSource reads the backfill candidates through the store and each POS
// order's current bill/rows/payments with plain SELECTs, so it works on a
// read-only dry-run connection.
type dbSource struct {
	repo *store.Repository
	pool *pgxpool.Pool
}

func (s dbSource) ListPOSOrderIDsForBackfill(ctx context.Context) ([]string, error) {
	return s.repo.ListPOSOrderIDsForBackfill(ctx)
}

func (s dbSource) LoadSnapshot(ctx context.Context, posOrderID string, paymentIDs []string) (Snapshot, error) {
	snapshot := Snapshot{KnownPaymentIDs: map[string]bool{}}

	err := s.pool.QueryRow(ctx, `
		SELECT id, status, total_amount, discount_amount
		FROM pos_bills
		WHERE pos_order_id = $1
	`, posOrderID).Scan(&snapshot.BillID, &snapshot.BillStatus, &snapshot.TotalAmount, &snapshot.DiscountAmount)
	switch {
	case err == nil:
		snapshot.BillExists = true
	case errors.Is(err, pgx.ErrNoRows):
	default:
		return Snapshot{}, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, status, amount, COALESCE(bill_id, ''), menu_item_name, category_name
		FROM payment_orders
		WHERE pos_order_id = $1
		ORDER BY created_at, id
	`, posOrderID)
	if err != nil {
		return Snapshot{}, err
	}
	for rows.Next() {
		var row SnapshotRow
		if err := rows.Scan(&row.ID, &row.Status, &row.Amount, &row.BillID, &row.MenuItemName, &row.CategoryName); err != nil {
			rows.Close()
			return Snapshot{}, err
		}
		snapshot.Rows = append(snapshot.Rows, row)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return Snapshot{}, err
	}

	if len(paymentIDs) == 0 {
		return snapshot, nil
	}
	known, err := s.pool.Query(ctx, `SELECT id FROM pos_payments WHERE id = ANY($1)`, paymentIDs)
	if err != nil {
		return Snapshot{}, err
	}
	defer known.Close()
	for known.Next() {
		var id string
		if err := known.Scan(&id); err != nil {
			return Snapshot{}, err
		}
		snapshot.KnownPaymentIDs[id] = true
	}
	return snapshot, known.Err()
}
