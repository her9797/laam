package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

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
		got, err := repo.UpdateSecretCouponRewardLabel(ctx, "vinyl-laam", "  2만원 할인권  ")
		if err != nil || got.RewardLabel != "2만원 할인권" {
			t.Fatalf("update = %+v, %v, want trimmed label", got, err)
		}
		if _, err := repo.UpdateSecretCouponRewardLabel(ctx, "vinyl-laam", "   "); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("blank label error = %v, want ErrInvalidInput", err)
		}
		if _, err := repo.UpdateSecretCouponRewardLabel(ctx, "vinyl-laam", strings.Repeat("가", 41)); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("41 rune label error = %v, want ErrInvalidInput", err)
		}
		if _, err := repo.UpdateSecretCouponRewardLabel(ctx, "vinyl-laam", strings.Repeat("가", 40)); err != nil {
			t.Errorf("40 rune label error = %v, want nil", err)
		}
		if _, err := repo.UpdateSecretCouponRewardLabel(ctx, "nope", "x"); !errors.Is(err, ErrNotFound) {
			t.Errorf("unknown id error = %v, want ErrNotFound", err)
		}
	})

	t.Run("redeem requires a claimed, unredeemed coupon", func(t *testing.T) {
		if _, err := repo.RedeemSecretCoupon(ctx, "table-badge"); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("redeem unclaimed error = %v, want ErrAlreadyExists", err)
		}
		if _, err := repo.RedeemSecretCoupon(ctx, "nope"); !errors.Is(err, ErrNotFound) {
			t.Errorf("redeem unknown error = %v, want ErrNotFound", err)
		}
		if _, err := repo.ClaimSecretCoupon(ctx, "table-badge", "3"); err != nil {
			t.Fatalf("claim: %v", err)
		}
		got, err := repo.RedeemSecretCoupon(ctx, "table-badge")
		if err != nil || got.RedeemedAt == nil || got.ClaimedAt == nil || got.TableNumber != "3" {
			t.Fatalf("redeem = %+v, %v, want redeemedAt set", got, err)
		}
		if _, err := repo.RedeemSecretCoupon(ctx, "table-badge"); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("redeem twice error = %v, want ErrAlreadyExists", err)
		}
	})

	t.Run("reset clears state, lowers notice count and allows claiming again", func(t *testing.T) {
		if _, err := repo.ClaimSecretCoupon(ctx, "first-order-8pm", "4"); err != nil {
			t.Fatalf("claim: %v", err)
		}
		got, err := repo.ResetSecretCoupon(ctx, "table-badge")
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
		if _, err := repo.ResetSecretCoupon(ctx, "table-badge"); err != nil {
			t.Errorf("idempotent reset error = %v", err)
		}
		if _, err := repo.ResetSecretCoupon(ctx, "nope"); !errors.Is(err, ErrNotFound) {
			t.Errorf("reset unknown error = %v, want ErrNotFound", err)
		}
		if _, err := repo.ClaimSecretCoupon(ctx, "table-badge", "5"); err != nil {
			t.Errorf("claim after reset error = %v", err)
		}
	})
}
