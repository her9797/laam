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

const maxSecretCouponHidingNoteRunes = 200

const secretCouponColumns = `id, reward_label, sort_order, claimed_at, table_number, redeemed_at, hiding_note`

type secretCouponRowScanner interface {
	Scan(dest ...any) error
}

func scanAdminSecretCoupon(row secretCouponRowScanner) (lamdata.AdminSecretCoupon, error) {
	var c lamdata.AdminSecretCoupon
	var claimedAt, redeemedAt *time.Time
	if err := row.Scan(&c.ID, &c.RewardLabel, &c.SortOrder, &claimedAt, &c.TableNumber, &redeemedAt, &c.HidingNote); err != nil {
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

// SecretCouponUpdate holds the optional fields of a partial coupon update.
// A nil field is left unchanged.
type SecretCouponUpdate struct {
	RewardLabel *string
	HidingNote  *string
}

// UpdateSecretCoupon changes the reward label and/or hiding note of one
// coupon. At least one field is required.
func (r *Repository) UpdateSecretCoupon(ctx context.Context, id string, update SecretCouponUpdate) (lamdata.AdminSecretCoupon, error) {
	if update.RewardLabel == nil && update.HidingNote == nil {
		return lamdata.AdminSecretCoupon{}, ErrInvalidInput
	}

	var rewardLabel, hidingNote *string
	if update.RewardLabel != nil {
		v := strings.TrimSpace(*update.RewardLabel)
		if v == "" || utf8.RuneCountInString(v) > maxSecretCouponRewardLabelRunes {
			return lamdata.AdminSecretCoupon{}, ErrInvalidInput
		}
		rewardLabel = &v
	}
	if update.HidingNote != nil {
		v := strings.TrimSpace(*update.HidingNote)
		if utf8.RuneCountInString(v) > maxSecretCouponHidingNoteRunes {
			return lamdata.AdminSecretCoupon{}, ErrInvalidInput
		}
		hidingNote = &v
	}

	c, err := scanAdminSecretCoupon(r.pool.QueryRow(ctx, `
		UPDATE secret_coupons
		SET reward_label = COALESCE($2, reward_label),
		    hiding_note = COALESCE($3, hiding_note)
		WHERE id = $1
		RETURNING `+secretCouponColumns, id, rewardLabel, hidingNote))
	if errors.Is(err, pgx.ErrNoRows) {
		return lamdata.AdminSecretCoupon{}, ErrNotFound
	}
	if err != nil {
		return lamdata.AdminSecretCoupon{}, classifyError(err)
	}
	return c, nil
}

// secretCouponNoticeLockKey serializes every transaction that changes
// whether a secret coupon is discovered (customer claim, admin reset). Each of
// them recounts the claimed coupons to rewrite the single progress notice,
// and under READ COMMITTED two concurrent transactions cannot see each
// other's uncommitted rows, so the last writer could publish a stale count.
// Holding this transaction-scoped advisory lock before touching a coupon row
// makes the recount observe every earlier change. It is distinct from the
// other advisory lock keys (posOrderLockNamespace, posTableSyncLockKey).
const secretCouponNoticeLockKey = 815234911

func lockSecretCouponNotice(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, int64(secretCouponNoticeLockKey))
	return err
}

// RedeemSecretCoupon marks a discovered coupon as exchanged for the physical
// reward, but only if the coupon is still the discovery the caller's screen
// showed (claimedAt, compared at second precision). Unknown ids return
// ErrNotFound; undiscovered, already redeemed or re-discovered coupons return
// ErrAlreadyExists (HTTP 409).
func (r *Repository) RedeemSecretCoupon(ctx context.Context, id string, claimedAt time.Time) (lamdata.AdminSecretCoupon, error) {
	c, err := scanAdminSecretCoupon(r.pool.QueryRow(ctx, `
		UPDATE secret_coupons SET redeemed_at = NOW()
		WHERE id = $1 AND claimed_at IS NOT NULL AND date_trunc('second', claimed_at) = $2::timestamptz
		  AND redeemed_at IS NULL
		RETURNING `+secretCouponColumns, id, claimedAt))
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

// ResetSecretCoupon returns a discovered coupon to the undiscovered state and
// refreshes the hunt-progress notice, but only if the coupon is still the
// discovery the caller's screen showed (claimedAt, second precision). Unknown
// ids return ErrNotFound; undiscovered or re-discovered coupons return
// ErrAlreadyExists (HTTP 409).
func (r *Repository) ResetSecretCoupon(ctx context.Context, id string, claimedAt time.Time) (lamdata.AdminSecretCoupon, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return lamdata.AdminSecretCoupon{}, err
	}
	defer tx.Rollback(ctx)

	if err := lockSecretCouponNotice(ctx, tx); err != nil {
		return lamdata.AdminSecretCoupon{}, err
	}
	c, err := scanAdminSecretCoupon(tx.QueryRow(ctx, `
		UPDATE secret_coupons SET claimed_at = NULL, table_number = '', redeemed_at = NULL
		WHERE id = $1 AND claimed_at IS NOT NULL AND date_trunc('second', claimed_at) = $2::timestamptz
		RETURNING `+secretCouponColumns, id, claimedAt))
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM secret_coupons WHERE id = $1)`, id).Scan(&exists); err != nil {
			return lamdata.AdminSecretCoupon{}, err
		}
		if !exists {
			return lamdata.AdminSecretCoupon{}, ErrNotFound
		}
		return lamdata.AdminSecretCoupon{}, ErrAlreadyExists
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
// progress notice, returning the count. Shared by claim and admin reset; the
// caller must already hold lockSecretCouponNotice.
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
