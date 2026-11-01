package store

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/her9797/laam/laam-api/internal/lamdata"
)

// seedMenuContentItem inserts one Toss-linked menu item with a Toss
// description and one Toss label (colored amber) and returns its id.
func seedMenuContentItem(t *testing.T, ctx context.Context) string {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO menu_categories (id, label, is_visible, sort_order) VALUES ('food', 'Food', TRUE, 1);
		INSERT INTO menu_items (id, category_id, name, description, price, is_visible, sort_order, toss_catalog_item_id, toss_labels, label_colors)
		VALUES ('fries', 'food', '감자튀김', '토스 설명', '5,000원', TRUE, 1, 'pos-fries', ARRAY['추천'], ARRAY['amber']);
	`); err != nil {
		t.Fatalf("seed menu item: %v", err)
	}
	return "fries"
}

func menuLabelIDByText(t *testing.T, data lamdata.BootstrapData, text string) string {
	t.Helper()
	for _, label := range data.MenuLabels {
		if label.Text == text {
			return label.ID
		}
	}
	t.Fatalf("menu label %q not found in %+v", text, data.MenuLabels)
	return ""
}

func mustBootstrap(t *testing.T, repo *Repository, ctx context.Context) lamdata.BootstrapData {
	t.Helper()
	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	return data
}

func TestRepository_MenuLabelLifecycle(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if data := mustBootstrap(t, repo, ctx); data.MenuLabels == nil || len(data.MenuLabels) != 0 {
		t.Fatalf("MenuLabels on empty state = %#v, want empty non-nil slice", data.MenuLabels)
	}

	if err := repo.CreateMenuLabel(ctx, "  시그니처  ", ""); err != nil {
		t.Fatalf("CreateMenuLabel() error = %v", err)
	}
	if err := repo.CreateMenuLabel(ctx, "인기", "pink"); err != nil {
		t.Fatalf("CreateMenuLabel() error = %v", err)
	}
	if err := repo.CreateMenuLabel(ctx, strings.Repeat("가", 20), "blue"); err != nil {
		t.Fatalf("CreateMenuLabel(20 runes) error = %v", err)
	}

	data := mustBootstrap(t, repo, ctx)
	if len(data.MenuLabels) != 3 {
		t.Fatalf("MenuLabels = %+v, want 3", data.MenuLabels)
	}
	first, second := data.MenuLabels[0], data.MenuLabels[1]
	if first.ID == "" || first.Text != "시그니처" || first.Color != "green" || second.Text != "인기" || second.Color != "pink" {
		t.Fatalf("MenuLabels = %+v, want 시그니처/green then 인기/pink", data.MenuLabels)
	}
	if !(first.SortOrder < second.SortOrder && second.SortOrder < data.MenuLabels[2].SortOrder) {
		t.Fatalf("sort orders = %d,%d,%d, want ascending", first.SortOrder, second.SortOrder, data.MenuLabels[2].SortOrder)
	}

	t.Run("invalid input is rejected", func(t *testing.T) {
		cases := []struct{ text, color string }{
			{"", "green"},
			{"   ", "green"},
			{strings.Repeat("가", 21), "green"},
			{"정상", "red"},
		}
		for _, c := range cases {
			if err := repo.CreateMenuLabel(ctx, c.text, c.color); !errors.Is(err, ErrInvalidInput) {
				t.Errorf("CreateMenuLabel(%q, %q) error = %v, want ErrInvalidInput", c.text, c.color, err)
			}
		}
	})

	t.Run("duplicate text is rejected case-insensitively", func(t *testing.T) {
		if err := repo.CreateMenuLabel(ctx, "Best", "green"); err != nil {
			t.Fatalf("CreateMenuLabel(Best) error = %v", err)
		}
		if err := repo.CreateMenuLabel(ctx, " best ", ""); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("CreateMenuLabel(best) error = %v, want ErrAlreadyExists", err)
		}
	})

	t.Run("update changes text and color", func(t *testing.T) {
		if err := repo.UpdateMenuLabel(ctx, first.ID, " 대표 ", "blue"); err != nil {
			t.Fatalf("UpdateMenuLabel() error = %v", err)
		}
		data := mustBootstrap(t, repo, ctx)
		if got := data.MenuLabels[0]; got.ID != first.ID || got.Text != "대표" || got.Color != "blue" {
			t.Fatalf("MenuLabels[0] after update = %+v", got)
		}
		if err := repo.UpdateMenuLabel(ctx, first.ID, "인기", "green"); !errors.Is(err, ErrAlreadyExists) {
			t.Errorf("UpdateMenuLabel(duplicate) error = %v, want ErrAlreadyExists", err)
		}
		if err := repo.UpdateMenuLabel(ctx, first.ID, "대표", "red"); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("UpdateMenuLabel(bad color) error = %v, want ErrInvalidInput", err)
		}
		if err := repo.UpdateMenuLabel(ctx, "missing", "새 라벨", "green"); !errors.Is(err, ErrNotFound) {
			t.Errorf("UpdateMenuLabel(unknown) error = %v, want ErrNotFound", err)
		}
	})

	t.Run("delete removes the label and its assignments", func(t *testing.T) {
		itemID := seedMenuContentItem(t, ctx)
		if err := repo.UpdateMenuItemContent(ctx, itemID, "", []string{second.ID}); err != nil {
			t.Fatalf("UpdateMenuItemContent() error = %v", err)
		}
		if err := repo.DeleteMenuLabel(ctx, second.ID); err != nil {
			t.Fatalf("DeleteMenuLabel() error = %v", err)
		}
		data := mustBootstrap(t, repo, ctx)
		for _, label := range data.MenuLabels {
			if label.ID == second.ID {
				t.Fatalf("deleted label still listed: %+v", data.MenuLabels)
			}
		}
		if got := data.Items[0].LabelIDs; got == nil || len(got) != 0 {
			t.Fatalf("LabelIDs after label delete = %#v, want empty", got)
		}
		if err := repo.DeleteMenuLabel(ctx, second.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("DeleteMenuLabel(unknown) error = %v, want ErrNotFound", err)
		}
	})
}

func TestRepository_UpdateMenuItemContent(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	itemID := seedMenuContentItem(t, ctx)
	tossLabels := []lamdata.MenuItemLabel{{Text: "추천", Color: "amber"}}

	data := mustBootstrap(t, repo, ctx)
	item := data.Items[0]
	if item.Description != "토스 설명" || item.PosDescription != "토스 설명" || item.DescriptionOverride != "" {
		t.Fatalf("initial descriptions = %q / %q / %q", item.Description, item.PosDescription, item.DescriptionOverride)
	}
	if item.LabelIDs == nil || len(item.LabelIDs) != 0 {
		t.Fatalf("initial LabelIDs = %#v, want empty non-nil slice", item.LabelIDs)
	}
	if !reflect.DeepEqual(item.Labels, tossLabels) {
		t.Fatalf("initial Labels = %+v, want Toss labels %+v", item.Labels, tossLabels)
	}

	if err := repo.CreateMenuLabel(ctx, "시그니처", "pink"); err != nil {
		t.Fatalf("CreateMenuLabel() error = %v", err)
	}
	if err := repo.CreateMenuLabel(ctx, "신규", "blue"); err != nil {
		t.Fatalf("CreateMenuLabel() error = %v", err)
	}
	data = mustBootstrap(t, repo, ctx)
	signature, fresh := menuLabelIDByText(t, data, "시그니처"), menuLabelIDByText(t, data, "신규")

	if err := repo.UpdateMenuItemContent(ctx, itemID, "  운영자 설명  ", []string{fresh, signature}); err != nil {
		t.Fatalf("UpdateMenuItemContent() error = %v", err)
	}
	data = mustBootstrap(t, repo, ctx)
	item = data.Items[0]
	if item.Description != "운영자 설명" || item.PosDescription != "토스 설명" || item.DescriptionOverride != "운영자 설명" {
		t.Fatalf("descriptions after override = %q / %q / %q", item.Description, item.PosDescription, item.DescriptionOverride)
	}
	if !reflect.DeepEqual(item.LabelIDs, []string{fresh, signature}) {
		t.Fatalf("LabelIDs = %v, want [%s %s]", item.LabelIDs, fresh, signature)
	}
	wantAssigned := []lamdata.MenuItemLabel{{Text: "신규", Color: "blue"}, {Text: "시그니처", Color: "pink"}}
	if !reflect.DeepEqual(item.Labels, wantAssigned) {
		t.Fatalf("Labels = %+v, want assigned %+v", item.Labels, wantAssigned)
	}

	t.Run("invalid input is rejected and keeps the previous content", func(t *testing.T) {
		cases := map[string]struct {
			description string
			labelIDs    []string
		}{
			"description over 300 runes": {strings.Repeat("가", 301), nil},
			"more than five labels":      {"", []string{"a", "b", "c", "d", "e", "f"}},
			"duplicate label ids":        {"", []string{signature, signature}},
			"unknown label id":           {"", []string{signature, "missing"}},
			"blank label id":             {"", []string{" "}},
		}
		for name, c := range cases {
			if err := repo.UpdateMenuItemContent(ctx, itemID, c.description, c.labelIDs); !errors.Is(err, ErrInvalidInput) {
				t.Errorf("%s: error = %v, want ErrInvalidInput", name, err)
			}
		}
		item := mustBootstrap(t, repo, ctx).Items[0]
		if item.DescriptionOverride != "운영자 설명" || !reflect.DeepEqual(item.LabelIDs, []string{fresh, signature}) {
			t.Fatalf("content changed after rejected updates: %q %v", item.DescriptionOverride, item.LabelIDs)
		}
	})

	t.Run("300 runes is accepted", func(t *testing.T) {
		if err := repo.UpdateMenuItemContent(ctx, itemID, strings.Repeat("가", 300), []string{signature}); err != nil {
			t.Fatalf("UpdateMenuItemContent(300 runes) error = %v", err)
		}
	})

	t.Run("unknown item is not found", func(t *testing.T) {
		if err := repo.UpdateMenuItemContent(ctx, "missing", "설명", nil); !errors.Is(err, ErrNotFound) {
			t.Errorf("UpdateMenuItemContent(unknown item) error = %v, want ErrNotFound", err)
		}
	})

	t.Run("empty content clears override and falls back to Toss labels", func(t *testing.T) {
		if err := repo.UpdateMenuItemContent(ctx, itemID, "   ", nil); err != nil {
			t.Fatalf("UpdateMenuItemContent(clear) error = %v", err)
		}
		item := mustBootstrap(t, repo, ctx).Items[0]
		if item.Description != "토스 설명" || item.DescriptionOverride != "" || len(item.LabelIDs) != 0 || item.LabelIDs == nil {
			t.Fatalf("after clear = %q / %q / %#v", item.Description, item.DescriptionOverride, item.LabelIDs)
		}
		if !reflect.DeepEqual(item.Labels, tossLabels) {
			t.Fatalf("Labels after clear = %+v, want Toss labels %+v", item.Labels, tossLabels)
		}
		var isNull bool
		if err := testPool.QueryRow(ctx, `SELECT description_override IS NULL FROM menu_items WHERE id = $1`, itemID).Scan(&isNull); err != nil || !isNull {
			t.Fatalf("description_override IS NULL = %v, err = %v; want NULL", isNull, err)
		}
	})
}

func TestRepository_SyncTossCatalogKeepsMenuContentOverrides(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	itemID := seedMenuContentItem(t, ctx)
	if err := repo.CreateMenuLabel(ctx, "시그니처", "pink"); err != nil {
		t.Fatalf("CreateMenuLabel() error = %v", err)
	}
	labelID := menuLabelIDByText(t, mustBootstrap(t, repo, ctx), "시그니처")
	if err := repo.UpdateMenuItemContent(ctx, itemID, "운영자 설명", []string{labelID}); err != nil {
		t.Fatalf("UpdateMenuItemContent() error = %v", err)
	}

	for range 2 {
		if _, err := repo.SyncTossCatalog(ctx,
			[]TossCatalogCategory{{ID: "food", Label: "Food", SortOrder: 1, IsVisible: true}},
			[]TossCatalogItem{{ID: "pos-fries", Name: "감자튀김", Description: "새 토스 설명", Labels: []string{"인기"}, CategoryID: "food", Price: 6000, IsVisible: true, SortOrder: 1}},
		); err != nil {
			t.Fatalf("SyncTossCatalog() error = %v", err)
		}
	}

	item := mustBootstrap(t, repo, ctx).Items[0]
	if item.ID != itemID || item.PosDescription != "새 토스 설명" || item.Description != "운영자 설명" || item.DescriptionOverride != "운영자 설명" {
		t.Fatalf("after sync = id:%q pos:%q effective:%q override:%q", item.ID, item.PosDescription, item.Description, item.DescriptionOverride)
	}
	if !reflect.DeepEqual(item.LabelIDs, []string{labelID}) {
		t.Fatalf("LabelIDs after sync = %v, want [%s]", item.LabelIDs, labelID)
	}
	if want := []lamdata.MenuItemLabel{{Text: "시그니처", Color: "pink"}}; !reflect.DeepEqual(item.Labels, want) {
		t.Fatalf("Labels after sync = %+v, want %+v", item.Labels, want)
	}
}
