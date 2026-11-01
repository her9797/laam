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

func mustBootstrap(t *testing.T, repo *Repository, ctx context.Context) lamdata.BootstrapData {
	t.Helper()
	data, err := repo.GetBootstrapData(ctx)
	if err != nil {
		t.Fatalf("GetBootstrapData() error = %v", err)
	}
	return data
}

func TestRepository_UpdateMenuItemContent(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	itemID := seedMenuContentItem(t, ctx)
	tossLabels := []lamdata.MenuItemLabel{{Text: "추천", Color: "amber"}}

	item := mustBootstrap(t, repo, ctx).Items[0]
	if item.Description != "토스 설명" || item.PosDescription != "토스 설명" || item.DescriptionOverride != "" {
		t.Fatalf("initial descriptions = %q / %q / %q", item.Description, item.PosDescription, item.DescriptionOverride)
	}
	if item.CustomLabels == nil || len(item.CustomLabels) != 0 {
		t.Fatalf("initial CustomLabels = %#v, want empty non-nil slice", item.CustomLabels)
	}
	if !reflect.DeepEqual(item.Labels, tossLabels) {
		t.Fatalf("initial Labels = %+v, want Toss labels %+v", item.Labels, tossLabels)
	}

	input := []lamdata.MenuItemLabel{{Text: "  신규 ", Color: " blue "}, {Text: strings.Repeat("가", 20), Color: "pink"}}
	if err := repo.UpdateMenuItemContent(ctx, itemID, "  운영자 설명  ", input); err != nil {
		t.Fatalf("UpdateMenuItemContent() error = %v", err)
	}
	item = mustBootstrap(t, repo, ctx).Items[0]
	if item.Description != "운영자 설명" || item.PosDescription != "토스 설명" || item.DescriptionOverride != "운영자 설명" {
		t.Fatalf("descriptions after override = %q / %q / %q", item.Description, item.PosDescription, item.DescriptionOverride)
	}
	want := []lamdata.MenuItemLabel{{Text: "신규", Color: "blue"}, {Text: strings.Repeat("가", 20), Color: "pink"}}
	if !reflect.DeepEqual(item.CustomLabels, want) {
		t.Fatalf("CustomLabels = %+v, want trimmed %+v", item.CustomLabels, want)
	}
	if !reflect.DeepEqual(item.Labels, want) {
		t.Fatalf("Labels = %+v, want custom labels %+v", item.Labels, want)
	}

	t.Run("invalid input is rejected and keeps the previous content", func(t *testing.T) {
		six := make([]lamdata.MenuItemLabel, 6)
		for index := range six {
			six[index] = lamdata.MenuItemLabel{Text: string(rune('a' + index)), Color: "green"}
		}
		cases := map[string]struct {
			description string
			labels      []lamdata.MenuItemLabel
		}{
			"description over 300 runes":              {strings.Repeat("가", 301), nil},
			"more than five labels":                   {"", six},
			"blank text":                              {"", []lamdata.MenuItemLabel{{Text: "  ", Color: "green"}}},
			"text over 20 runes":                      {"", []lamdata.MenuItemLabel{{Text: strings.Repeat("가", 21), Color: "green"}}},
			"unknown color":                           {"", []lamdata.MenuItemLabel{{Text: "인기", Color: "red"}}},
			"empty color":                             {"", []lamdata.MenuItemLabel{{Text: "인기"}}},
			"duplicate text ignoring case and spaces": {"", []lamdata.MenuItemLabel{{Text: "Best", Color: "green"}, {Text: " best ", Color: "blue"}}},
		}
		for name, c := range cases {
			if err := repo.UpdateMenuItemContent(ctx, itemID, c.description, c.labels); !errors.Is(err, ErrInvalidInput) {
				t.Errorf("%s: error = %v, want ErrInvalidInput", name, err)
			}
		}
		item := mustBootstrap(t, repo, ctx).Items[0]
		if item.DescriptionOverride != "운영자 설명" || !reflect.DeepEqual(item.CustomLabels, want) {
			t.Fatalf("content changed after rejected updates: %q %+v", item.DescriptionOverride, item.CustomLabels)
		}
	})

	t.Run("300 runes and five labels are accepted", func(t *testing.T) {
		five := make([]lamdata.MenuItemLabel, 5)
		for index := range five {
			five[index] = lamdata.MenuItemLabel{Text: string(rune('a' + index)), Color: "amber"}
		}
		if err := repo.UpdateMenuItemContent(ctx, itemID, strings.Repeat("가", 300), five); err != nil {
			t.Fatalf("UpdateMenuItemContent(300 runes, 5 labels) error = %v", err)
		}
		if got := mustBootstrap(t, repo, ctx).Items[0].CustomLabels; !reflect.DeepEqual(got, five) {
			t.Fatalf("CustomLabels = %+v, want %+v", got, five)
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
		if item.Description != "토스 설명" || item.DescriptionOverride != "" || item.CustomLabels == nil || len(item.CustomLabels) != 0 {
			t.Fatalf("after clear = %q / %q / %#v", item.Description, item.DescriptionOverride, item.CustomLabels)
		}
		if !reflect.DeepEqual(item.Labels, tossLabels) {
			t.Fatalf("Labels after clear = %+v, want Toss labels %+v", item.Labels, tossLabels)
		}
		var isNull bool
		var stored string
		if err := testPool.QueryRow(ctx, `SELECT description_override IS NULL, custom_labels::text FROM menu_items WHERE id = $1`, itemID).Scan(&isNull, &stored); err != nil || !isNull || stored != "[]" {
			t.Fatalf("description_override IS NULL = %v, custom_labels = %q, err = %v; want NULL and []", isNull, stored, err)
		}
	})
}

func TestRepository_SyncTossCatalogKeepsMenuContentOverrides(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	itemID := seedMenuContentItem(t, ctx)
	custom := []lamdata.MenuItemLabel{{Text: "시그니처", Color: "pink"}}
	if err := repo.UpdateMenuItemContent(ctx, itemID, "운영자 설명", custom); err != nil {
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
	if !reflect.DeepEqual(item.CustomLabels, custom) {
		t.Fatalf("CustomLabels after sync = %+v, want %+v", item.CustomLabels, custom)
	}
	if !reflect.DeepEqual(item.Labels, custom) {
		t.Fatalf("Labels after sync = %+v, want %+v", item.Labels, custom)
	}
}
