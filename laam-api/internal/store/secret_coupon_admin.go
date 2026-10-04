package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/her9797/laam/laam-api/internal/lamdata"
	"github.com/jackc/pgx/v5"
)

const maxSecretCouponRewardLabelRunes = 40

const secretCouponColumns = `id, reward_label, sort_order, claimed_at, table_number, redeemed_at`

type secretCouponRowScanner interface {
	Scan(dest ...any) error
}

func scanAdminSecretCoupon(row secretCouponRowScanner) (lamdata.AdminSecretCoupon, error) {
	var c lamdata.AdminSecretCoupon
	var claimedAt, redeemedAt *time.Time
	if err := row.Scan(&c.ID, &c.RewardLabel, &c.SortOrder, &claimedAt, &c.TableNumber, &redeemedAt); err != nil {
		return lamdata.AdminSecretCoupon{}, err
	}
	c.ClaimedAt = formatCouponTime(claimedAt)
	c.RedeemedAt = formatCouponTime(redeemedAt)
	return c, nil
}

func formatCouponTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

// ListSecretCoupons returns every secret coupon ordered by sort_order.
func (r *Repository) ListSecretCoupons(ctx context.Context) ([]lamdata.AdminSecretCoupon, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+secretCouponColumns+` FROM secret_coupons ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []lamdata.AdminSecretCoupon{}
	for rows.Next() {
		c, err := scanAdminSecretCoupon(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

// UpdateSecretCouponRewardLabel changes the reward label of one coupon.
func (r *Repository) UpdateSecretCouponRewardLabel(ctx context.Context, id string, rewardLabel string) (lamdata.AdminSecretCoupon, error) {
	rewardLabel = strings.TrimSpace(rewardLabel)
	if rewardLabel == "" || utf8.RuneCountInString(rewardLabel) > maxSecretCouponRewardLabelRunes {
		return lamdata.AdminSecretCoupon{}, ErrInvalidInput
	}

	c, err := scanAdminSecretCoupon(r.pool.QueryRow(ctx, `
		UPDATE secret_coupons SET reward_label = $2 WHERE id = $1
		RETURNING `+secretCouponColumns, id, rewardLabel))
	if errors.Is(err, pgx.ErrNoRows) {
		return lamdata.AdminSecretCoupon{}, ErrNotFound
	}
	if err != nil {
		return lamdata.AdminSecretCoupon{}, classifyError(err)
	}
	return c, nil
}

// RedeemSecretCoupon marks a claimed coupon as exchanged for the physical
// reward. Unknown ids return ErrNotFound; unclaimed or already redeemed
// coupons return ErrAlreadyExists (HTTP 409).
func (r *Repository) RedeemSecretCoupon(ctx context.Context, id string) (lamdata.AdminSecretCoupon, error) {
	c, err := scanAdminSecretCoupon(r.pool.QueryRow(ctx, `
		UPDATE secret_coupons SET redeemed_at = NOW()
		WHERE id = $1 AND claimed_at IS NOT NULL AND redeemed_at IS NULL
		RETURNING `+secretCouponColumns, id))
	if err == nil {
		return c, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return lamdata.AdminSecretCoupon{}, classifyError(err)
	}

	var exists bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM secret_coupons WHERE id = $1)`, id).Scan(&exists); err != nil {
		return lamdata.AdminSecretCoupon{}, err
	}
	if !exists {
		return lamdata.AdminSecretCoupon{}, ErrNotFound
	}
	return lamdata.AdminSecretCoupon{}, ErrAlreadyExists
}

// ResetSecretCoupon returns a coupon to the undiscovered state and refreshes
// the hunt-progress notice. It is idempotent.
func (r *Repository) ResetSecretCoupon(ctx context.Context, id string) (lamdata.AdminSecretCoupon, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return lamdata.AdminSecretCoupon{}, err
	}
	defer tx.Rollback(ctx)

	c, err := scanAdminSecretCoupon(tx.QueryRow(ctx, `
		UPDATE secret_coupons SET claimed_at = NULL, table_number = '', redeemed_at = NULL
		WHERE id = $1
		RETURNING `+secretCouponColumns, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return lamdata.AdminSecretCoupon{}, ErrNotFound
	}
	if err != nil {
		return lamdata.AdminSecretCoupon{}, classifyError(err)
	}
	if _, err := syncSecretCouponNotice(ctx, tx); err != nil {
		return lamdata.AdminSecretCoupon{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return lamdata.AdminSecretCoupon{}, err
	}
	return c, nil
}

// syncSecretCouponNotice recounts claimed coupons and upserts the single
// progress notice, returning the count. Shared by claim and admin reset.
func syncSecretCouponNotice(ctx context.Context, tx pgx.Tx) (int, error) {
	var claimedCount int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM secret_coupons WHERE claimed_at IS NOT NULL`).Scan(&claimedCount); err != nil {
		return 0, err
	}

	noticeText := fmt.Sprintf("쉿크릿 쿠폰 발견 갯수 (%d/%d)", claimedCount, TotalSecretCoupons)
	var sortOrder int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), 0) + 1 FROM notices`).Scan(&sortOrder); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notices (id, text, is_visible, sort_order)
		VALUES ($1, $2, true, $3)
		ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text
	`, secretCouponNoticeID, noticeText, sortOrder); err != nil {
		return 0, classifyError(err)
	}
	return claimedCount, nil
}
