package store

import (
	"context"
	"testing"
)

func TestRepositorySyncTossCatalogPreservesMetadataAndHidesUnavailableItems(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO menu_categories (id, label, is_visible, sort_order) VALUES
			('highball', '하이볼', TRUE, 1),
			('whisky', '위스키', TRUE, 2),
			('cocktail', '칵테일', TRUE, 3),
			('non-alcohol', '논알콜', TRUE, 4);
		INSERT INTO menu_items (id, category_id, badge, name, description, price, is_visible, sort_order) VALUES
			('earlgrey', 'highball', 'best', '얼그레이 하이볼', '기존 설명', '11,000원', TRUE, 1),
			('local-only', 'cocktail', NULL, '로컬 전용', '숨겨질 메뉴', '9,000원', TRUE, 2);
	`); err != nil {
		t.Fatalf("seed menu: %v", err)
	}

	result, err := repo.SyncTossCatalog(ctx, []TossCatalogItem{
		{ID: "pos-earlgrey", Name: "얼그레이하이볼", Description: "토스 설명", ImageURL: "https://cdn.example.com/earlgrey.png", Badge: "추천", CategoryID: "highball", Price: 10000, IsVisible: true, SortOrder: 3, Options: []TossCatalogOption{{ID: "option-shot", Title: "샷", Enabled: true, Required: false, MinChoices: 1, MaxChoices: 1, Choices: []TossCatalogOptionChoice{{ID: "choice-shot", Title: "샷 추가", PriceValue: 500, Enabled: true, State: "ON_SALE", MinQuantity: 1, MaxQuantity: 1}}}}},
		{ID: "pos-whisky", Name: "제임슨", CategoryID: "whisky", Price: 9000, IsVisible: true, SortOrder: 4},
		{ID: "pos-zero", Name: "신데렐라", CategoryID: "non-alcohol", Price: 0, IsVisible: false, SortOrder: 5},
	})
	if err != nil {
		t.Fatalf("SyncTossCatalog() error = %v", err)
	}
	if result.Linked != 1 || result.Created != 2 {
		t.Fatalf("result = %+v, want linked=1 created=2", result)
	}

	var description, badge, price, tossID string
	var visible bool
	if err := testPool.QueryRow(ctx, `SELECT description, COALESCE(badge, ''), price, is_visible, toss_catalog_item_id FROM menu_items WHERE id = 'earlgrey'`).Scan(&description, &badge, &price, &visible, &tossID); err != nil {
		t.Fatalf("read matched item: %v", err)
	}
	if description != "기존 설명" || badge != "추천" || price != "10,000원" || !visible || tossID != "pos-earlgrey" {
		t.Fatalf("matched item = description:%q badge:%q price:%q visible:%v tossID:%q", description, badge, price, visible, tossID)
	}
	var imageURL, optionTitle, choiceTitle string
	var choicePrice int64
	if err := testPool.QueryRow(ctx, `
		SELECT mi.toss_image_url, mo.title, moc.title, moc.price_value
		FROM menu_items mi
		JOIN menu_item_options mio ON mio.menu_item_id = mi.id
		JOIN menu_options mo ON mo.id = mio.option_id
		JOIN menu_option_choices moc ON moc.option_id = mo.id
		WHERE mi.id = 'earlgrey'
	`).Scan(&imageURL, &optionTitle, &choiceTitle, &choicePrice); err != nil {
		t.Fatalf("read synchronized option/image: %v", err)
	}
	if imageURL != "https://cdn.example.com/earlgrey.png" || optionTitle != "샷" || choiceTitle != "샷 추가" || choicePrice != 500 {
		t.Fatalf("synced image/options = %q %q %q %d", imageURL, optionTitle, choiceTitle, choicePrice)
	}
	if err := testPool.QueryRow(ctx, `SELECT is_visible FROM menu_items WHERE id = 'local-only'`).Scan(&visible); err != nil || visible {
		t.Fatalf("local-only visible=%v err=%v, want false", visible, err)
	}
	if err := testPool.QueryRow(ctx, `SELECT is_visible FROM menu_items WHERE toss_catalog_item_id = 'pos-zero'`).Scan(&visible); err != nil || visible {
		t.Fatalf("zero-price visible=%v err=%v, want false", visible, err)
	}

	_, err = repo.SyncTossCatalog(ctx, []TossCatalogItem{
		{ID: "pos-earlgrey", Name: "얼그레이하이볼", CategoryID: "highball", Price: 12000, IsVisible: true, SortOrder: 1},
	})
	if err != nil {
		t.Fatalf("second SyncTossCatalog() error = %v", err)
	}
	if err := testPool.QueryRow(ctx, `SELECT price FROM menu_items WHERE toss_catalog_item_id = 'pos-earlgrey'`).Scan(&price); err != nil || price != "12,000원" {
		t.Fatalf("updated price=%q err=%v", price, err)
	}
	if err := testPool.QueryRow(ctx, `SELECT is_visible FROM menu_items WHERE toss_catalog_item_id = 'pos-whisky'`).Scan(&visible); err != nil || visible {
		t.Fatalf("missing POS item visible=%v err=%v, want false", visible, err)
	}
}
