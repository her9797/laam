package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
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
