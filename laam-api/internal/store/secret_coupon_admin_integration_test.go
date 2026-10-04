package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func ptr(s string) *string { return &s }

func TestRepository_AdminSecretCoupons(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	t.Run("list returns coupons in sort order with null times", func(t *testing.T) {
		items, err := repo.ListSecretCoupons(ctx)
		if err != nil {
			t.Fatalf("ListSecretCoupons() error = %v", err)
		}
		if len(items) != 5 || items[0].ID != "vinyl-laam" || items[4].ID != "owner-compliment-request" {
			t.Fatalf("items = %+v, want 5 coupons in sort order", items)
		}
		if items[0].ClaimedAt != nil || items[0].RedeemedAt != nil || items[0].TableNumber != "" {
			t.Errorf("items[0] = %+v, want unclaimed", items[0])
		}
	})

	t.Run("update reward label validates input", func(t *testing.T) {
		got, err := repo.UpdateSecretCoupon(ctx, "vinyl-laam", SecretCouponUpdate{RewardLabel: ptr("  2만원 할인권  ")})
		if err != nil || got.RewardLabel != "2만원 할인권" {
			t.Fatalf("update = %+v, %v, want trimmed label", got, err)
		}
		if _, err := repo.UpdateSecretCoupon(ctx, "vinyl-laam", SecretCouponUpdate{RewardLabel: ptr("   ")}); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("blank label error = %v, want ErrInvalidInput", err)
		}
		if _, err := repo.UpdateSecretCoupon(ctx, "vinyl-laam", SecretCouponUpdate{RewardLabel: ptr(strings.Repeat("가", 41))}); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("41 rune label error = %v, want ErrInvalidInput", err)
		}
		if _, err := repo.UpdateSecretCoupon(ctx, "vinyl-laam", SecretCouponUpdate{RewardLabel: ptr(strings.Repeat("가", 40))}); err != nil {
			t.Errorf("40 rune label error = %v, want nil", err)
		}
		if _, err := repo.UpdateSecretCoupon(ctx, "nope", SecretCouponUpdate{RewardLabel: ptr("x")}); !errors.Is(err, ErrNotFound) {
			t.Errorf("unknown id error = %v, want ErrNotFound", err)
		}
	})

	t.Run("list includes seeded hiding notes", func(t *testing.T) {
		items, err := repo.ListSecretCoupons(ctx)
		if err != nil {
			t.Fatalf("ListSecretCoupons() error = %v", err)
		}
		want := map[string]string{
			"vinyl-laam":               "손님 홈 화면의 LP판을 누르면 발견",
			"table-badge":              "화면에 떠 있는 테이블 번호 배지를 누르면 발견",
			"first-order-8pm":          "한국 시간 20:00~20:59에 가장 먼저 주문한 테이블이 발견",
			"crush-song-request":       "가수를 Crush 또는 크러쉬로 노래 신청하면 발견",
			"owner-compliment-request": "특별 요청에 \"사장님\"과 \"잘생겼어요\"를 함께 쓰면 발견",
		}
		for _, c := range items {
			if c.HidingNote != want[c.ID] {
				t.Errorf("%s hidingNote = %q, want %q", c.ID, c.HidingNote, want[c.ID])
			}
		}
	})

	t.Run("partial update keeps the other field", func(t *testing.T) {
		label, note := "partial 라벨", "  새 메모  "
		got, err := repo.UpdateSecretCoupon(ctx, "table-badge", SecretCouponUpdate{HidingNote: &note})
		if err != nil || got.HidingNote != "새 메모" || got.RewardLabel != "1만원 할인권" {
			t.Fatalf("note-only update = %+v, %v", got, err)
		}
		got, err = repo.UpdateSecretCoupon(ctx, "table-badge", SecretCouponUpdate{RewardLabel: &label})
		if err != nil || got.RewardLabel != label || got.HidingNote != "새 메모" {
			t.Fatalf("label-only update = %+v, %v", got, err)
		}
		empty := "   "
		got, err = repo.UpdateSecretCoupon(ctx, "table-badge", SecretCouponUpdate{HidingNote: &empty})
		if err != nil || got.HidingNote != "" || got.RewardLabel != label {
			t.Fatalf("empty note update = %+v, %v", got, err)
		}
		long := strings.Repeat("가", 201)
		if _, err := repo.UpdateSecretCoupon(ctx, "table-badge", SecretCouponUpdate{HidingNote: &long}); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("201 rune note error = %v, want ErrInvalidInput", err)
		}
		ok := strings.Repeat("가", 200)
		if _, err := repo.UpdateSecretCoupon(ctx, "table-badge", SecretCouponUpdate{HidingNote: &ok}); err != nil {
			t.Errorf("200 rune note error = %v, want nil", err)
		}
		blank := "  "
		if _, err := repo.UpdateSecretCoupon(ctx, "table-badge", SecretCouponUpdate{RewardLabel: &blank}); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("blank label error = %v, want ErrInvalidInput", err)
		}
		if _, err := repo.UpdateSecretCoupon(ctx, "nope", SecretCouponUpdate{HidingNote: &note}); !errors.Is(err, ErrNotFound) {
			t.Errorf("unknown id error = %v, want ErrNotFound", err)
		}
	})

	t.Run("redeem requires a claimed, unredeemed coupon", func(t *testing.T) {
		if _, err := repo.RedeemSecretCoupon(ctx, "table-badge", claimedAtOf(t, repo, "table-badge")); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("redeem unclaimed error = %v, want ErrAlreadyExists", err)
		}
		if _, err := repo.RedeemSecretCoupon(ctx, "nope", time.Now()); !errors.Is(err, ErrNotFound) {
			t.Errorf("redeem unknown error = %v, want ErrNotFound", err)
		}
		if _, err := repo.ClaimSecretCoupon(ctx, "table-badge", "3"); err != nil {
			t.Fatalf("claim: %v", err)
		}
		got, err := repo.RedeemSecretCoupon(ctx, "table-badge", claimedAtOf(t, repo, "table-badge"))
		if err != nil || got.RedeemedAt == nil || got.ClaimedAt == nil || got.TableNumber != "3" {
			t.Fatalf("redeem = %+v, %v, want redeemedAt set", got, err)
		}
		if _, err := repo.RedeemSecretCoupon(ctx, "table-badge", claimedAtOf(t, repo, "table-badge")); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("redeem twice error = %v, want ErrAlreadyExists", err)
		}
	})

	t.Run("reset clears state, lowers notice count and allows claiming again", func(t *testing.T) {
		if _, err := repo.ClaimSecretCoupon(ctx, "first-order-8pm", "4"); err != nil {
			t.Fatalf("claim: %v", err)
		}
		got0ClaimedAt := claimedAtOf(t, repo, "table-badge")
		got, err := repo.ResetSecretCoupon(ctx, "table-badge", got0ClaimedAt)
		if err != nil {
			t.Fatalf("reset: %v", err)
		}
		if got.ClaimedAt != nil || got.RedeemedAt != nil || got.TableNumber != "" {
			t.Fatalf("reset = %+v, want cleared", got)
		}
		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData: %v", err)
		}
		want := fmt.Sprintf("쉿크릿 쿠폰 발견 갯수 (1/%d)", TotalSecretCoupons)
		if len(data.Notices) != 1 || data.Notices[0].Text != want {
			t.Errorf("Notices = %+v, want single %q", data.Notices, want)
		}
		if _, err := repo.ResetSecretCoupon(ctx, "table-badge", got0ClaimedAt); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("second reset error = %v, want ErrAlreadyExists", err)
		}
		if _, err := repo.ResetSecretCoupon(ctx, "nope", time.Now()); !errors.Is(err, ErrNotFound) {
			t.Errorf("reset unknown error = %v, want ErrNotFound", err)
		}
		if _, err := repo.ClaimSecretCoupon(ctx, "table-badge", "5"); err != nil {
			t.Errorf("claim after reset error = %v", err)
		}
	})
}

// claimedAtOf returns the claimedAt a screen would have received for a coupon.
func claimedAtOf(t *testing.T, repo *Repository, id string) time.Time {
	t.Helper()
	items, err := repo.ListSecretCoupons(context.Background())
	if err != nil {
		t.Fatalf("ListSecretCoupons() error = %v", err)
	}
	for _, c := range items {
		if c.ID != id {
			continue
		}
		if c.ClaimedAt == nil {
			return time.Time{}
		}
		parsed, err := time.Parse(time.RFC3339, *c.ClaimedAt)
		if err != nil {
			t.Fatalf("parse claimedAt %q: %v", *c.ClaimedAt, err)
		}
		return parsed
	}
	t.Fatalf("coupon %s not found", id)
	return time.Time{}
}

func TestRepository_SecretCouponStaleScreenIsRejected(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	// A claim, an admin reset and a new claim by another customer, leaving the
	// first screen with a stale claimedAt.
	rediscover := func(t *testing.T) (stale, current time.Time) {
		t.Helper()
		if _, err := repo.ClaimSecretCoupon(ctx, "table-badge", "3"); err != nil {
			t.Fatalf("claim: %v", err)
		}
		stale = claimedAtOf(t, repo, "table-badge")
		if _, err := repo.ResetSecretCoupon(ctx, "table-badge", stale); err != nil {
			t.Fatalf("reset: %v", err)
		}
		if _, err := repo.ClaimSecretCoupon(ctx, "table-badge", "7"); err != nil {
			t.Fatalf("reclaim: %v", err)
		}
		// Make sure the new discovery is in a different second than the old one.
		if _, err := testPool.Exec(ctx, `UPDATE secret_coupons SET claimed_at = claimed_at + interval '1 hour' WHERE id = 'table-badge'`); err != nil {
			t.Fatalf("shift claimed_at: %v", err)
		}
		return stale, claimedAtOf(t, repo, "table-badge")
	}

	t.Run("redeem with stale claimedAt conflicts and changes nothing", func(t *testing.T) {
		repo = resetDB(t)
		stale, current := rediscover(t)
		if _, err := repo.RedeemSecretCoupon(ctx, "table-badge", stale); !errors.Is(err, ErrAlreadyExists) {
			t.Fatalf("redeem stale error = %v, want ErrAlreadyExists", err)
		}
		after := claimedAtOf(t, repo, "table-badge")
		if !after.Equal(current) {
			t.Errorf("claimedAt changed to %v", after)
		}
		items, _ := repo.ListSecretCoupons(ctx)
		for _, c := range items {
			if c.ID == "table-badge" && (c.RedeemedAt != nil || c.TableNumber != "7") {
				t.Errorf("coupon changed: %+v", c)
			}
		}
		got, err := repo.RedeemSecretCoupon(ctx, "table-badge", current)
		if err != nil || got.RedeemedAt == nil {
			t.Fatalf("redeem current = %+v, %v, want success", got, err)
		}
	})

	t.Run("reset with stale claimedAt conflicts and changes nothing", func(t *testing.T) {
		repo = resetDB(t)
		stale, current := rediscover(t)
		if _, err := repo.ResetSecretCoupon(ctx, "table-badge", stale); !errors.Is(err, ErrAlreadyExists) {
			t.Fatalf("reset stale error = %v, want ErrAlreadyExists", err)
		}
		if after := claimedAtOf(t, repo, "table-badge"); !after.Equal(current) {
			t.Errorf("claimedAt changed to %v", after)
		}
		if _, err := repo.ResetSecretCoupon(ctx, "table-badge", current); err != nil {
			t.Fatalf("reset current error = %v, want success", err)
		}
	})

	t.Run("unclaimed coupon conflicts for redeem and reset", func(t *testing.T) {
		repo = resetDB(t)
		now := time.Now()
		if _, err := repo.RedeemSecretCoupon(ctx, "vinyl-laam", now); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("redeem unclaimed error = %v, want ErrAlreadyExists", err)
		}
		if _, err := repo.ResetSecretCoupon(ctx, "vinyl-laam", now); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("reset unclaimed error = %v, want ErrAlreadyExists", err)
		}
		if _, err := repo.ResetSecretCoupon(ctx, "nope", now); !errors.Is(err, ErrNotFound) {
			t.Errorf("reset unknown error = %v, want ErrNotFound", err)
		}
	})

	t.Run("claimedAt matches although the database keeps microseconds", func(t *testing.T) {
		repo = resetDB(t)
		if _, err := testPool.Exec(ctx, `UPDATE secret_coupons SET claimed_at = '2026-01-02 03:04:05.678901+00', table_number = '2' WHERE id = 'vinyl-laam'`); err != nil {
			t.Fatalf("seed claimed_at: %v", err)
		}
		at := claimedAtOf(t, repo, "vinyl-laam")
		if _, err := repo.RedeemSecretCoupon(ctx, "vinyl-laam", at); err != nil {
			t.Fatalf("redeem with second-precision claimedAt error = %v", err)
		}
	})
}

func TestRepository_SecretCouponNoticeCountSerializesWithClaim(t *testing.T) {
	repo := resetDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Coupon A is already discovered and committed.
	if _, err := repo.ClaimSecretCoupon(ctx, "vinyl-laam", "1"); err != nil {
		t.Fatalf("claim A: %v", err)
	}
	aClaimedAt := claimedAtOf(t, repo, "vinyl-laam")

	// Another discovery (coupon B) is in flight and has not committed yet.
	tx, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(context.Background())
	if _, err := claimSecretCoupon(ctx, tx, "table-badge", "2"); err != nil {
		t.Fatalf("claim B in tx: %v", err)
	}

	// An admin resets A meanwhile. It must wait for the in-flight discovery.
	done := make(chan error, 1)
	go func() {
		_, err := repo.ResetSecretCoupon(ctx, "vinyl-laam", aClaimedAt)
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("reset finished (err=%v) before the discovery committed; notice count can go stale", err)
	case <-time.After(500 * time.Millisecond):
	}

	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("reset: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("reset still blocked after the discovery committed")
	}

	var claimed int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM secret_coupons WHERE claimed_at IS NOT NULL`).Scan(&claimed); err != nil {
		t.Fatalf("count: %v", err)
	}
	var text string
	if err := testPool.QueryRow(ctx, `SELECT text FROM notices WHERE id = $1`, secretCouponNoticeID).Scan(&text); err != nil {
		t.Fatalf("notice: %v", err)
	}
	if want := fmt.Sprintf("쉿크릿 쿠폰 발견 갯수 (%d/%d)", claimed, TotalSecretCoupons); text != want {
		t.Errorf("notice = %q, want %q", text, want)
	}
}

func TestEnsureSchema_HidingNoteIgnoresSameNamedTableInOtherSchema(t *testing.T) {
	if testPool == nil {
		t.Skip("docker not available; skipping integration test")
	}
	ctx := context.Background()
	const schema = "hiding_note_schema_test"
	if _, err := testPool.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE`); err != nil {
		t.Fatalf("drop schema: %v", err)
	}
	if _, err := testPool.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DROP SCHEMA IF EXISTS `+schema+` CASCADE`)
	})
	// The victim table lacks hiding_note while public.secret_coupons (from the
	// main test schema) already has it.
	if _, err := testPool.Exec(ctx, `CREATE TABLE `+schema+`.secret_coupons (
		id TEXT PRIMARY KEY, reward_label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
		claimed_at TIMESTAMPTZ, table_number TEXT NOT NULL DEFAULT '', redeemed_at TIMESTAMPTZ)`); err != nil {
		t.Fatalf("create victim table: %v", err)
	}

	cfg := testPool.Config()
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ", public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	if err := New(pool).EnsureSchema(ctx); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	var n int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = 'secret_coupons' AND column_name = 'hiding_note'`, schema).Scan(&n); err != nil {
		t.Fatalf("query: %v", err)
	}
	if n != 1 {
		t.Errorf("hiding_note columns in %s.secret_coupons = %d, want 1", schema, n)
	}
}
