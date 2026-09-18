package store

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/her9797/laam/laam-api/internal/lamdata"
)

func TestRepository_GetBootstrapData_EmptyState(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}

	if data.Store.Name != "Test Store" {
		t.Errorf("Store.Name = %q, want %q", data.Store.Name, "Test Store")
	}
	if len(data.Categories) != 0 || len(data.Items) != 0 || len(data.RequestGuides) != 0 || len(data.Notices) != 0 {
		t.Errorf("expected empty collections on a freshly reset DB, got %+v", data)
	}
}

func TestRepository_SeedDefaults(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `TRUNCATE store_profile RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("truncate store_profile: %v", err)
	}

	if err := repo.SeedDefaults(ctx); err != nil {
		t.Fatalf("SeedDefaults() error = %v", err)
	}

	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	if data.Store.Name != "laam" {
		t.Errorf("Store.Name = %q, want %q", data.Store.Name, "laam")
	}
	if len(data.Categories) == 0 || len(data.Items) == 0 || len(data.Notices) == 0 {
		t.Errorf("expected SeedDefaults to populate categories, items and notices, got %+v", data)
	}

	// SeedDefaults also seeds sample transactional data (customer requests,
	// special requests, payment orders) so a fresh local `docker compose up`
	// has something to look at in the admin web's request/order screens
	// without the operator manually inserting rows first.
	requests, err := repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() error = %v", err)
	}
	if len(requests) == 0 {
		t.Error("expected SeedDefaults to populate sample customer requests")
	}
	hasSongRequest := false
	for _, r := range requests {
		if strings.HasPrefix(r.Text, "[노래 신청]") {
			hasSongRequest = true
			break
		}
	}
	if !hasSongRequest {
		t.Error("expected at least one sample customer request to be a song request ([노래 신청] prefix)")
	}

	specialRequests, err := repo.ListSpecialRequests(ctx)
	if err != nil {
		t.Fatalf("ListSpecialRequests() error = %v", err)
	}
	if len(specialRequests) == 0 {
		t.Error("expected SeedDefaults to populate sample special requests")
	}

	var paymentOrderCount int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM payment_orders`).Scan(&paymentOrderCount); err != nil {
		t.Fatalf("count payment_orders: %v", err)
	}
	if paymentOrderCount == 0 {
		t.Error("expected SeedDefaults to populate sample payment orders")
	}
	var doneOrderCount, readyOrderCount int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM payment_orders WHERE status = 'DONE'`).Scan(&doneOrderCount); err != nil {
		t.Fatalf("count DONE payment_orders: %v", err)
	}
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM payment_orders WHERE status = 'READY'`).Scan(&readyOrderCount); err != nil {
		t.Fatalf("count READY payment_orders: %v", err)
	}
	if doneOrderCount == 0 {
		t.Error("expected at least one sample DONE payment order (for order-history/sales-stats screens)")
	}
	if readyOrderCount == 0 {
		t.Error("expected at least one sample READY payment order (an unpaid/abandoned order)")
	}

	// SeedDefaults must be idempotent once a store_profile row exists.
	if err := repo.SeedDefaults(ctx); err != nil {
		t.Fatalf("second SeedDefaults() error = %v", err)
	}
	dataAgain, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() after second seed error = %v", err)
	}
	if len(dataAgain.Categories) != len(data.Categories) {
		t.Errorf("SeedDefaults should be a no-op when data already exists, got %d categories, want %d", len(dataAgain.Categories), len(data.Categories))
	}
	requestsAgain, err := repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() after second seed error = %v", err)
	}
	if len(requestsAgain) != len(requests) {
		t.Errorf("SeedDefaults should not duplicate sample customer requests on a second call, got %d, want %d", len(requestsAgain), len(requests))
	}
}

func TestRepository_CreateCategory(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		if err := repo.CreateCategory(ctx, "drinks", "Drinks", true); err != nil {
			t.Fatalf("CreateCategory() error = %v", err)
		}

		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		if len(data.Categories) != 1 || data.Categories[0].ID != "drinks" || data.Categories[0].Label != "Drinks" {
			t.Errorf("Categories = %+v, want a single 'drinks' category", data.Categories)
		}
	})

	t.Run("empty id or label is rejected", func(t *testing.T) {
		if err := repo.CreateCategory(ctx, "", "Label", true); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("CreateCategory(empty id) error = %v, want ErrInvalidInput", err)
		}
		if err := repo.CreateCategory(ctx, "id", "", true); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("CreateCategory(empty label) error = %v, want ErrInvalidInput", err)
		}
	})

	t.Run("duplicate id is rejected", func(t *testing.T) {
		if err := repo.CreateCategory(ctx, "duplicate", "First", true); err != nil {
			t.Fatalf("CreateCategory() first insert error = %v", err)
		}
		if err := repo.CreateCategory(ctx, "duplicate", "Second", true); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("CreateCategory(duplicate id) error = %v, want ErrAlreadyExists", err)
		}
	})
}

func TestRepository_CreateMenuItem(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCategory(ctx, "food", "Food", true); err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}

	t.Run("success", func(t *testing.T) {
		input := CreateMenuItemInput{CategoryID: "food", Name: "Fries", Description: "Crispy", Price: "5000", IsVisible: true}
		if err := repo.CreateMenuItem(ctx, input); err != nil {
			t.Fatalf("CreateMenuItem() error = %v", err)
		}

		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		if len(data.Items) != 1 || data.Items[0].Name != "Fries" {
			t.Errorf("Items = %+v, want a single 'Fries' item", data.Items)
		}
	})

	t.Run("missing required fields is rejected", func(t *testing.T) {
		input := CreateMenuItemInput{CategoryID: "food", Name: "", Description: "x", Price: "1"}
		if err := repo.CreateMenuItem(ctx, input); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("CreateMenuItem(missing name) error = %v, want ErrInvalidInput", err)
		}
	})

	t.Run("unknown category is rejected", func(t *testing.T) {
		input := CreateMenuItemInput{CategoryID: "does-not-exist", Name: "x", Description: "x", Price: "1"}
		if err := repo.CreateMenuItem(ctx, input); !errors.Is(err, ErrNotFound) {
			t.Errorf("CreateMenuItem(unknown category) error = %v, want ErrNotFound", err)
		}
	})
}

func TestRepository_UpdateStoreCopies(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		if err := repo.UpdateStoreCopies(ctx, "song", "request", "event"); err != nil {
			t.Fatalf("UpdateStoreCopies() error = %v", err)
		}

		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		if data.Store.SongRequestCopy != "song" || data.Store.RequestCopy != "request" || data.Store.EventCopy != "event" {
			t.Errorf("Store copies = %+v, want song/request/event", data.Store)
		}
	})

	t.Run("blank field is rejected", func(t *testing.T) {
		if err := repo.UpdateStoreCopies(ctx, "", "request", "event"); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("UpdateStoreCopies(blank song copy) error = %v, want ErrInvalidInput", err)
		}
	})
}

func TestRepository_UpdateCategoryVisibility(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCategory(ctx, "food", "Food", true); err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}

	t.Run("success", func(t *testing.T) {
		if err := repo.UpdateCategoryVisibility(ctx, "food", false); err != nil {
			t.Fatalf("UpdateCategoryVisibility() error = %v", err)
		}
		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		if data.Categories[0].IsVisible {
			t.Errorf("Categories[0].IsVisible = true, want false")
		}
	})

	t.Run("unknown id is not found", func(t *testing.T) {
		if err := repo.UpdateCategoryVisibility(ctx, "missing", true); !errors.Is(err, ErrNotFound) {
			t.Errorf("UpdateCategoryVisibility(missing id) error = %v, want ErrNotFound", err)
		}
	})
}

func TestRepository_DeleteCategory(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCategory(ctx, "food", "Food", true); err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}

	t.Run("success", func(t *testing.T) {
		if err := repo.DeleteCategory(ctx, "food"); err != nil {
			t.Fatalf("DeleteCategory() error = %v", err)
		}
		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		if len(data.Categories) != 0 {
			t.Errorf("Categories = %+v, want empty after delete", data.Categories)
		}
	})

	t.Run("unknown id is not found", func(t *testing.T) {
		if err := repo.DeleteCategory(ctx, "missing"); !errors.Is(err, ErrNotFound) {
			t.Errorf("DeleteCategory(missing id) error = %v, want ErrNotFound", err)
		}
	})
}

func TestRepository_DeleteMenuItem(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCategory(ctx, "food", "Food", true); err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}
	if err := repo.CreateMenuItem(ctx, CreateMenuItemInput{CategoryID: "food", Name: "Fries", Description: "d", Price: "1"}); err != nil {
		t.Fatalf("CreateMenuItem() error = %v", err)
	}
	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	itemID := data.Items[0].ID

	t.Run("success", func(t *testing.T) {
		if err := repo.DeleteMenuItem(ctx, itemID); err != nil {
			t.Fatalf("DeleteMenuItem() error = %v", err)
		}
	})

	t.Run("unknown id is not found", func(t *testing.T) {
		if err := repo.DeleteMenuItem(ctx, itemID); !errors.Is(err, ErrNotFound) {
			t.Errorf("DeleteMenuItem(already deleted id) error = %v, want ErrNotFound", err)
		}
	})
}

func TestRepository_MenuItemLabelColors(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCategory(ctx, "food", "Food", true); err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}
	if err := repo.CreateMenuItem(ctx, CreateMenuItemInput{CategoryID: "food", Name: "Fries", Description: "d", Price: "1"}); err != nil {
		t.Fatalf("CreateMenuItem() error = %v", err)
	}
	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	itemID := data.Items[0].ID
	if len(data.Items[0].Labels) != 0 {
		t.Fatalf("Labels before any Toss labels exist = %+v, want none", data.Items[0].Labels)
	}

	if _, err := testPool.Exec(ctx, `UPDATE menu_items SET toss_labels = $2 WHERE id = $1`, itemID, []string{"추천", "인기", "신규"}); err != nil {
		t.Fatalf("seed toss_labels: %v", err)
	}

	t.Run("colors default to empty until an operator sets them", func(t *testing.T) {
		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		want := []lamdata.MenuItemLabel{{Text: "추천"}, {Text: "인기"}, {Text: "신규"}}
		if !reflect.DeepEqual(data.Items[0].Labels, want) {
			t.Fatalf("Labels = %+v, want %+v", data.Items[0].Labels, want)
		}
	})

	t.Run("UpdateMenuItemLabelColors sets a color per position", func(t *testing.T) {
		if err := repo.UpdateMenuItemLabelColors(ctx, itemID, []string{"green", "amber"}); err != nil {
			t.Fatalf("UpdateMenuItemLabelColors() error = %v", err)
		}

		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		want := []lamdata.MenuItemLabel{{Text: "추천", Color: "green"}, {Text: "인기", Color: "amber"}, {Text: "신규"}}
		if !reflect.DeepEqual(data.Items[0].Labels, want) {
			t.Fatalf("Labels after color update = %+v, want %+v", data.Items[0].Labels, want)
		}
	})

	t.Run("unknown id is not found", func(t *testing.T) {
		if err := repo.UpdateMenuItemLabelColors(ctx, "does-not-exist", []string{"green"}); !errors.Is(err, ErrNotFound) {
			t.Errorf("UpdateMenuItemLabelColors(unknown id) error = %v, want ErrNotFound", err)
		}
	})
}

func TestRepository_RequestGuideLifecycle(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateRequestGuide(ctx, "please wait", true); err != nil {
		t.Fatalf("CreateRequestGuide() error = %v", err)
	}
	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	if len(data.RequestGuides) != 1 || data.RequestGuides[0].Text != "please wait" {
		t.Fatalf("RequestGuides = %+v, want a single 'please wait' guide", data.RequestGuides)
	}
	guideID := data.RequestGuides[0].ID

	if err := repo.CreateRequestGuide(ctx, "", true); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("CreateRequestGuide(blank text) error = %v, want ErrInvalidInput", err)
	}

	if err := repo.UpdateRequestGuideVisibility(ctx, guideID, false); err != nil {
		t.Fatalf("UpdateRequestGuideVisibility() error = %v", err)
	}
	if err := repo.UpdateRequestGuideVisibility(ctx, "missing", false); !errors.Is(err, ErrNotFound) {
		t.Errorf("UpdateRequestGuideVisibility(missing id) error = %v, want ErrNotFound", err)
	}

	if err := repo.DeleteRequestGuide(ctx, guideID); err != nil {
		t.Fatalf("DeleteRequestGuide() error = %v", err)
	}
	if err := repo.DeleteRequestGuide(ctx, guideID); !errors.Is(err, ErrNotFound) {
		t.Errorf("DeleteRequestGuide(already deleted) error = %v, want ErrNotFound", err)
	}
}

func TestRepository_NoticeLifecycle(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateNotice(ctx, "closed on mondays", true); err != nil {
		t.Fatalf("CreateNotice() error = %v", err)
	}
	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	if len(data.Notices) != 1 {
		t.Fatalf("Notices = %+v, want a single notice", data.Notices)
	}
	noticeID := data.Notices[0].ID

	if err := repo.CreateNotice(ctx, "", true); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("CreateNotice(blank text) error = %v, want ErrInvalidInput", err)
	}

	if err := repo.UpdateNotice(ctx, noticeID, "open every day"); err != nil {
		t.Fatalf("UpdateNotice() error = %v", err)
	}
	data, err = repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	if data.Notices[0].Text != "open every day" {
		t.Errorf("Notices[0].Text = %q, want %q", data.Notices[0].Text, "open every day")
	}
	if err := repo.UpdateNotice(ctx, "missing", "text"); !errors.Is(err, ErrNotFound) {
		t.Errorf("UpdateNotice(missing id) error = %v, want ErrNotFound", err)
	}

	if err := repo.UpdateNoticeVisibility(ctx, noticeID, false); err != nil {
		t.Fatalf("UpdateNoticeVisibility() error = %v", err)
	}
	if err := repo.UpdateNoticeVisibility(ctx, "missing", false); !errors.Is(err, ErrNotFound) {
		t.Errorf("UpdateNoticeVisibility(missing id) error = %v, want ErrNotFound", err)
	}

	if err := repo.DeleteNotice(ctx, noticeID); err != nil {
		t.Fatalf("DeleteNotice() error = %v", err)
	}
	if err := repo.DeleteNotice(ctx, noticeID); !errors.Is(err, ErrNotFound) {
		t.Errorf("DeleteNotice(already deleted) error = %v, want ErrNotFound", err)
	}
}

func TestRepository_ClaimSecretCoupon(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	claim, err := repo.ClaimSecretCoupon(ctx, "vinyl-laam", "T-01")
	if err != nil {
		t.Fatalf("ClaimSecretCoupon() error = %v", err)
	}
	if claim.RewardLabel != "1만원 할인권" || claim.ClaimedCount != 1 || claim.TotalCount != TotalSecretCoupons {
		t.Fatalf("claim = %+v, want RewardLabel=1만원 할인권 ClaimedCount=1 TotalCount=%d", claim, TotalSecretCoupons)
	}

	t.Run("claiming again fails", func(t *testing.T) {
		if _, err := repo.ClaimSecretCoupon(ctx, "vinyl-laam", "T-02"); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("second ClaimSecretCoupon() error = %v, want ErrAlreadyExists", err)
		}
	})

	t.Run("unknown id is not found", func(t *testing.T) {
		if _, err := repo.ClaimSecretCoupon(ctx, "does-not-exist", "T-01"); !errors.Is(err, ErrNotFound) {
			t.Errorf("ClaimSecretCoupon(unknown id) error = %v, want ErrNotFound", err)
		}
	})

	t.Run("updates a single progress notice in place", func(t *testing.T) {
		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		if len(data.Notices) != 1 {
			t.Fatalf("Notices = %+v, want a single progress notice", data.Notices)
		}
		want := fmt.Sprintf("쉿크릿 쿠폰 발견 갯수 (1/%d)", TotalSecretCoupons)
		if data.Notices[0].Text != want {
			t.Errorf("Notices[0].Text = %q, want %q", data.Notices[0].Text, want)
		}

		claim, err := repo.ClaimSecretCoupon(ctx, "table-badge", "T-01")
		if err != nil {
			t.Fatalf("ClaimSecretCoupon(table-badge) error = %v", err)
		}
		if claim.RewardLabel != "1만원 할인권" || claim.ClaimedCount != 2 || claim.TotalCount != TotalSecretCoupons {
			t.Fatalf("claim = %+v, want RewardLabel=1만원 할인권 ClaimedCount=2 TotalCount=%d", claim, TotalSecretCoupons)
		}

		data, err = repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		if len(data.Notices) != 1 {
			t.Fatalf("Notices = %+v, want the same single notice updated in place, not a new one", data.Notices)
		}
		want = fmt.Sprintf("쉿크릿 쿠폰 발견 갯수 (2/%d)", TotalSecretCoupons)
		if data.Notices[0].Text != want {
			t.Errorf("Notices[0].Text = %q, want %q", data.Notices[0].Text, want)
		}
	})
}

func TestRepository_CustomerRequestLifecycle(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	t.Run("create validates required fields", func(t *testing.T) {
		if err := repo.CreateCustomerRequest(ctx, "", "help"); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("CreateCustomerRequest(blank table) error = %v, want ErrInvalidInput", err)
		}
		if err := repo.CreateCustomerRequest(ctx, "T-01", ""); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("CreateCustomerRequest(blank text) error = %v, want ErrInvalidInput", err)
		}
	})

	if err := repo.CreateCustomerRequest(ctx, "T-01", "napkins please"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}

	requests, err := repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() error = %v", err)
	}
	if len(requests) != 1 || requests[0].Status != "pending" || requests[0].HandledAt != "" {
		t.Fatalf("requests = %+v, want a single pending request with no handledAt", requests)
	}
	requestID := requests[0].ID

	t.Run("status update validates status value", func(t *testing.T) {
		if err := repo.UpdateCustomerRequestStatus(ctx, requestID, "bogus"); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("UpdateCustomerRequestStatus(bogus status) error = %v, want ErrInvalidInput", err)
		}
	})

	t.Run("status update to unknown id is not found", func(t *testing.T) {
		if err := repo.UpdateCustomerRequestStatus(ctx, "missing", "checked"); !errors.Is(err, ErrNotFound) {
			t.Errorf("UpdateCustomerRequestStatus(missing id) error = %v, want ErrNotFound", err)
		}
	})

	t.Run("completing a request sets handledAt", func(t *testing.T) {
		if err := repo.UpdateCustomerRequestStatus(ctx, requestID, "completed"); err != nil {
			t.Fatalf("UpdateCustomerRequestStatus() error = %v", err)
		}
		requests, err := repo.ListCustomerRequests(ctx)
		if err != nil {
			t.Fatalf("ListCustomerRequests() error = %v", err)
		}
		if requests[0].Status != "completed" || requests[0].HandledAt == "" {
			t.Errorf("requests[0] = %+v, want status=completed with a non-empty handledAt", requests[0])
		}
	})

	t.Run("moving back to pending clears handledAt", func(t *testing.T) {
		if err := repo.UpdateCustomerRequestStatus(ctx, requestID, "pending"); err != nil {
			t.Fatalf("UpdateCustomerRequestStatus() error = %v", err)
		}
		requests, err := repo.ListCustomerRequests(ctx)
		if err != nil {
			t.Fatalf("ListCustomerRequests() error = %v", err)
		}
		if requests[0].HandledAt != "" {
			t.Errorf("requests[0].HandledAt = %q, want empty after reverting to pending", requests[0].HandledAt)
		}
	})

	t.Run("delete", func(t *testing.T) {
		if err := repo.DeleteCustomerRequest(ctx, requestID); err != nil {
			t.Fatalf("DeleteCustomerRequest() error = %v", err)
		}
		if err := repo.DeleteCustomerRequest(ctx, requestID); !errors.Is(err, ErrNotFound) {
			t.Errorf("DeleteCustomerRequest(already deleted) error = %v, want ErrNotFound", err)
		}
	})
}

func TestRepository_SongPlaybackQueueLifecycle(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCustomerRequest(ctx, "T-01", "물 한 잔 주세요"); err != nil {
		t.Fatalf("CreateCustomerRequest(general) error = %v", err)
	}
	requests, err := repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() error = %v", err)
	}
	if _, err := repo.GetSongRequestQuery(ctx, requests[0].ID); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("GetSongRequestQuery(general) error = %v, want ErrInvalidInput", err)
	}

	if err := repo.CreateCustomerRequest(ctx, "T-02", "[노래 신청] Ditto - NewJeans"); err != nil {
		t.Fatalf("CreateCustomerRequest(song) error = %v", err)
	}
	requests, err = repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() error = %v", err)
	}
	requestID := requests[0].ID

	query, err := repo.GetSongRequestQuery(ctx, requestID)
	if err != nil {
		t.Fatalf("GetSongRequestQuery() error = %v", err)
	}
	if query != "Ditto - NewJeans" {
		t.Fatalf("GetSongRequestQuery() = %q", query)
	}

	input := QueueSongRequestInput{
		YouTubeVideoID:      "video-123",
		YouTubeTitle:        "NewJeans - Ditto",
		YouTubeChannelTitle: "HYBE LABELS",
	}
	queued, err := repo.QueueSongRequest(ctx, requestID, input)
	if err != nil {
		t.Fatalf("QueueSongRequest() error = %v", err)
	}
	if queued.Status != "queued" || queued.CustomerRequestID != requestID || queued.TableNumber != "T-02" {
		t.Fatalf("QueueSongRequest() = %+v", queued)
	}

	again, err := repo.QueueSongRequest(ctx, requestID, input)
	if err != nil {
		t.Fatalf("QueueSongRequest(idempotent) error = %v", err)
	}
	if again.ID != queued.ID {
		t.Fatalf("QueueSongRequest(idempotent).ID = %q, want %q", again.ID, queued.ID)
	}

	active, err := repo.ListActiveSongQueue(ctx)
	if err != nil {
		t.Fatalf("ListActiveSongQueue() error = %v", err)
	}
	if len(active) != 1 || active[0].ID != queued.ID {
		t.Fatalf("ListActiveSongQueue() = %+v", active)
	}

	if err := repo.UpdateSongQueueStatus(ctx, queued.ID, "queued"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("UpdateSongQueueStatus(queued) error = %v, want ErrInvalidInput", err)
	}
	if err := repo.UpdateSongQueueStatus(ctx, queued.ID, "playing"); err != nil {
		t.Fatalf("UpdateSongQueueStatus(playing) error = %v", err)
	}
	active, err = repo.ListActiveSongQueue(ctx)
	if err != nil || len(active) != 1 || active[0].Status != "playing" || active[0].StartedAt == "" {
		t.Fatalf("playing queue = %+v, error = %v", active, err)
	}

	if err := repo.UpdateSongQueueStatus(ctx, queued.ID, "completed"); err != nil {
		t.Fatalf("UpdateSongQueueStatus(completed) error = %v", err)
	}
	active, err = repo.ListActiveSongQueue(ctx)
	if err != nil || len(active) != 0 {
		t.Fatalf("completed active queue = %+v, error = %v", active, err)
	}
	requests, err = repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() error = %v", err)
	}
	if requests[1].Status != "completed" || requests[1].HandledAt == "" {
		t.Fatalf("completed customer request = %+v", requests[1])
	}
}

func TestRepository_UpdateCustomerRequestStatuses(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	t.Run("empty ids is invalid", func(t *testing.T) {
		if err := repo.UpdateCustomerRequestStatuses(ctx, nil, "checked"); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("UpdateCustomerRequestStatuses(nil ids) error = %v, want ErrInvalidInput", err)
		}
	})

	t.Run("invalid status is invalid", func(t *testing.T) {
		if err := repo.UpdateCustomerRequestStatuses(ctx, []string{"any"}, "bogus"); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("UpdateCustomerRequestStatuses(bogus status) error = %v, want ErrInvalidInput", err)
		}
	})

	t.Run("too many ids is invalid", func(t *testing.T) {
		ids := make([]string, 201)
		for i := range ids {
			ids[i] = fmt.Sprintf("id-%d", i)
		}
		if err := repo.UpdateCustomerRequestStatuses(ctx, ids, "checked"); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("UpdateCustomerRequestStatuses(201 ids) error = %v, want ErrInvalidInput", err)
		}
	})

	if err := repo.CreateCustomerRequest(ctx, "T-01", "first"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}
	if err := repo.CreateCustomerRequest(ctx, "T-02", "second"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}

	requests, err := repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() error = %v", err)
	}
	if len(requests) != 2 {
		t.Fatalf("len(requests) = %d, want 2", len(requests))
	}
	firstID, secondID := requests[0].ID, requests[1].ID

	t.Run("updates every matching id and ignores an unknown id without erroring", func(t *testing.T) {
		if err := repo.UpdateCustomerRequestStatuses(ctx, []string{firstID, secondID, "missing"}, "checked"); err != nil {
			t.Fatalf("UpdateCustomerRequestStatuses() error = %v", err)
		}

		updated, err := repo.ListCustomerRequests(ctx)
		if err != nil {
			t.Fatalf("ListCustomerRequests() error = %v", err)
		}
		if len(updated) != 2 {
			t.Fatalf("len(updated) = %d, want 2", len(updated))
		}
		for _, item := range updated {
			if item.Status != "checked" {
				t.Errorf("item %+v, want status=checked", item)
			}
		}
	})

	t.Run("bulk completing sets handledAt for every id", func(t *testing.T) {
		if err := repo.UpdateCustomerRequestStatuses(ctx, []string{firstID, secondID}, "completed"); err != nil {
			t.Fatalf("UpdateCustomerRequestStatuses() error = %v", err)
		}

		updated, err := repo.ListCustomerRequests(ctx)
		if err != nil {
			t.Fatalf("ListCustomerRequests() error = %v", err)
		}
		for _, item := range updated {
			if item.Status != "completed" || item.HandledAt == "" {
				t.Errorf("item %+v, want status=completed with a non-empty handledAt", item)
			}
		}
	})
}

func TestRepository_ListCustomerRequests_OrdersPendingBeforeCheckedBeforeCompleted(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCustomerRequest(ctx, "T-01", "completed one"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}
	firstBatch, err := repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() error = %v", err)
	}
	if err := repo.UpdateCustomerRequestStatus(ctx, firstBatch[0].ID, "completed"); err != nil {
		t.Fatalf("UpdateCustomerRequestStatus() error = %v", err)
	}

	if err := repo.CreateCustomerRequest(ctx, "T-02", "pending one"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}

	requests, err := repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() error = %v", err)
	}
	if len(requests) != 2 {
		t.Fatalf("len(requests) = %d, want 2", len(requests))
	}
	if requests[0].Status != "pending" || requests[1].Status != "completed" {
		t.Errorf("requests order = [%s, %s], want [pending, completed]", requests[0].Status, requests[1].Status)
	}
}

func TestRepository_SpecialRequestLifecycle(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	valid := lamdata.SpecialRequest{
		TableNumber:    "T-01",
		Gender:         "male",
		Name:           "Kim",
		Age:            "20s",
		Residence:      "Seoul",
		Instagram:      "@kim",
		IdealHeight:    "175",
		IdealResidence: "Gangnam",
		IdealAgeRange:  "late 20s",
		IdealDetails:   "tall",
		Text:           "hello",
	}

	t.Run("invalid gender is rejected", func(t *testing.T) {
		invalid := valid
		invalid.Gender = "unspecified"
		if err := repo.CreateSpecialRequest(ctx, invalid); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("CreateSpecialRequest(invalid gender) error = %v, want ErrInvalidInput", err)
		}
	})

	t.Run("blank field is rejected", func(t *testing.T) {
		invalid := valid
		invalid.Name = ""
		if err := repo.CreateSpecialRequest(ctx, invalid); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("CreateSpecialRequest(blank name) error = %v, want ErrInvalidInput", err)
		}
	})

	if err := repo.CreateSpecialRequest(ctx, valid); err != nil {
		t.Fatalf("CreateSpecialRequest() error = %v", err)
	}

	requests, err := repo.ListSpecialRequests(ctx)
	if err != nil {
		t.Fatalf("ListSpecialRequests() error = %v", err)
	}
	if len(requests) != 1 || requests[0].Name != "Kim" {
		t.Fatalf("requests = %+v, want a single 'Kim' request", requests)
	}
	if requests[0].IdealHeight != "175" || requests[0].IdealResidence != "Gangnam" ||
		requests[0].IdealAgeRange != "late 20s" || requests[0].IdealDetails != "tall" {
		t.Fatalf("ideal type fields = %+v, want height=175 residence=Gangnam ageRange='late 20s' details=tall", requests[0])
	}

	t.Run("delete", func(t *testing.T) {
		if err := repo.DeleteSpecialRequest(ctx, requests[0].ID); err != nil {
			t.Fatalf("DeleteSpecialRequest() error = %v", err)
		}
		if err := repo.DeleteSpecialRequest(ctx, requests[0].ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("DeleteSpecialRequest(already deleted) error = %v, want ErrNotFound", err)
		}
	})
}

func TestRepository_MenuImageLifecycle(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCategory(ctx, "food", "Food", true); err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}
	if err := repo.CreateMenuItem(ctx, CreateMenuItemInput{CategoryID: "food", Name: "Fries", Description: "d", Price: "1"}); err != nil {
		t.Fatalf("CreateMenuItem() error = %v", err)
	}
	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	menuItemID := data.Items[0].ID

	t.Run("missing menu item is not found", func(t *testing.T) {
		input := CreateMenuImageInput{MenuItemID: "missing", Filename: "a.png", MimeType: "image/png", Content: []byte("x")}
		if err := repo.CreateMenuImage(ctx, input); !errors.Is(err, ErrNotFound) {
			t.Errorf("CreateMenuImage(missing menu item) error = %v, want ErrNotFound", err)
		}
	})

	t.Run("empty content is rejected", func(t *testing.T) {
		input := CreateMenuImageInput{MenuItemID: menuItemID, Filename: "a.png", MimeType: "image/png", Content: []byte{}}
		if err := repo.CreateMenuImage(ctx, input); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("CreateMenuImage(empty content) error = %v, want ErrInvalidInput", err)
		}
	})

	first := CreateMenuImageInput{MenuItemID: menuItemID, Filename: "first.png", MimeType: "image/png", Content: []byte("first"), IsPrimary: true}
	if err := repo.CreateMenuImage(ctx, first); err != nil {
		t.Fatalf("CreateMenuImage(first) error = %v", err)
	}

	second := CreateMenuImageInput{MenuItemID: menuItemID, Filename: "second.png", MimeType: "image/png", Content: []byte("second"), IsPrimary: true}
	if err := repo.CreateMenuImage(ctx, second); err != nil {
		t.Fatalf("CreateMenuImage(second) error = %v", err)
	}

	data, err = repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	images := data.Items[0].Images
	if len(images) != 2 {
		t.Fatalf("len(images) = %d, want 2", len(images))
	}

	primaryCount := 0
	var primaryImage, nonPrimaryImage lamdata.MenuImage
	for _, image := range images {
		if image.IsPrimary {
			primaryCount++
			primaryImage = image
		} else {
			nonPrimaryImage = image
		}
	}
	if primaryCount != 1 {
		t.Errorf("primary image count = %d, want 1 (setting a new primary should demote the previous one)", primaryCount)
	}
	if primaryImage.Filename != "second.png" {
		t.Errorf("primary image = %q, want %q (most recently created primary should win)", primaryImage.Filename, "second.png")
	}
	if nonPrimaryImage.Filename != "first.png" {
		t.Errorf("non-primary image = %q, want %q", nonPrimaryImage.Filename, "first.png")
	}

	t.Run("focus values are clamped", func(t *testing.T) {
		input := CreateMenuImageInput{MenuItemID: menuItemID, Filename: "focus.png", MimeType: "image/png", Content: []byte("x"), FocusX: -5, FocusY: 500}
		if err := repo.CreateMenuImage(ctx, input); err != nil {
			t.Fatalf("CreateMenuImage(focus) error = %v", err)
		}
		data, err := repo.GetBootstrapData(ctx)
		if err != nil {
			t.Fatalf("GetBootstrapData() error = %v", err)
		}
		var found *lamdata.MenuImage
		for i := range data.Items[0].Images {
			if data.Items[0].Images[i].Filename == "focus.png" {
				found = &data.Items[0].Images[i]
			}
		}
		if found == nil {
			t.Fatalf("focus.png not found in images: %+v", data.Items[0].Images)
		}
		if found.FocusX != 0 || found.FocusY != 100 {
			t.Errorf("FocusX/FocusY = %d/%d, want clamped 0/100", found.FocusX, found.FocusY)
		}
	})

	t.Run("GetMenuImageContent", func(t *testing.T) {
		content, err := repo.GetMenuImageContent(ctx, primaryImage.ID)
		if err != nil {
			t.Fatalf("GetMenuImageContent() error = %v", err)
		}
		if string(content.Content) != "second" {
			t.Errorf("content = %q, want %q", string(content.Content), "second")
		}

		if _, err := repo.GetMenuImageContent(ctx, "missing"); !errors.Is(err, ErrNotFound) {
			t.Errorf("GetMenuImageContent(missing id) error = %v, want ErrNotFound", err)
		}
	})
}

func TestRepository_GetMenuData_MirrorsBootstrapSubset(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCategory(ctx, "food", "Food", true); err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}

	menuData, err := repo.GetMenuData(ctx)
	if err != nil {
		t.Fatalf("GetMenuData() error = %v", err)
	}
	bootstrap, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}

	if menuData.Store != bootstrap.Store {
		t.Errorf("GetMenuData().Store = %+v, want %+v", menuData.Store, bootstrap.Store)
	}
	if len(menuData.Categories) != len(bootstrap.Categories) {
		t.Errorf("GetMenuData().Categories length = %d, want %d", len(menuData.Categories), len(bootstrap.Categories))
	}
}

func TestRepository_MenuItemRecipeLifecycle(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCategory(ctx, "food", "Food", true); err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}
	if err := repo.CreateMenuItem(ctx, CreateMenuItemInput{CategoryID: "food", Name: "Fries", Description: "d", Price: "1"}); err != nil {
		t.Fatalf("CreateMenuItem() error = %v", err)
	}
	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	itemID := data.Items[0].ID

	t.Run("defaults to empty strings", func(t *testing.T) {
		recipe, err := repo.GetMenuItemRecipe(ctx, itemID)
		if err != nil {
			t.Fatalf("GetMenuItemRecipe() error = %v", err)
		}
		if recipe.Ingredients != "" || recipe.Instructions != "" {
			t.Errorf("GetMenuItemRecipe() = %+v, want empty ingredients/instructions", recipe)
		}
	})

	t.Run("update then get reflects the change", func(t *testing.T) {
		if err := repo.UpdateMenuItemRecipe(ctx, itemID, "감자 200g, 소금", "180도에서 5분 튀긴다"); err != nil {
			t.Fatalf("UpdateMenuItemRecipe() error = %v", err)
		}

		recipe, err := repo.GetMenuItemRecipe(ctx, itemID)
		if err != nil {
			t.Fatalf("GetMenuItemRecipe() error = %v", err)
		}
		if recipe.Ingredients != "감자 200g, 소금" || recipe.Instructions != "180도에서 5분 튀긴다" {
			t.Errorf("GetMenuItemRecipe() = %+v, want updated ingredients/instructions", recipe)
		}
	})

	t.Run("unknown id is not found", func(t *testing.T) {
		if _, err := repo.GetMenuItemRecipe(ctx, "missing"); !errors.Is(err, ErrNotFound) {
			t.Errorf("GetMenuItemRecipe(missing id) error = %v, want ErrNotFound", err)
		}
		if err := repo.UpdateMenuItemRecipe(ctx, "missing", "a", "b"); !errors.Is(err, ErrNotFound) {
			t.Errorf("UpdateMenuItemRecipe(missing id) error = %v, want ErrNotFound", err)
		}
	})
}
