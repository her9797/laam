package store

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
)

type TossCatalogItem struct {
	ID          string
	Name        string
	Description string
	ImageURL    string
	Badge       string
	CategoryID  string
	Price       int64
	IsVisible   bool
	SortOrder   int
	Options     []TossCatalogOption
}

type TossCatalogOption struct {
	ID         string
	Title      string
	Enabled    bool
	SortOrder  int
	Required   bool
	MinChoices int
	MaxChoices int
	Choices    []TossCatalogOptionChoice
}

type TossCatalogOptionChoice struct {
	ID              string
	Title           string
	PriceValue      int64
	ImageURL        string
	Enabled         bool
	State           string
	SortOrder       int
	QuantityEnabled bool
	MinQuantity     int64
	MaxQuantity     int64
}

type TossCatalogSyncResult struct {
	Created int
	Linked  int
	Updated int
}

func (r *Repository) SyncTossCatalog(ctx context.Context, items []TossCatalogItem) (TossCatalogSyncResult, error) {
	if len(items) == 0 {
		return TossCatalogSyncResult{}, ErrInvalidInput
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return TossCatalogSyncResult{}, err
	}
	defer tx.Rollback(ctx)

	categories := []struct {
		id    string
		label string
		order int
	}{
		{id: "signature", label: "시그니처", order: 1},
		{id: "highball", label: "하이볼", order: 2},
		{id: "whisky", label: "위스키", order: 3},
		{id: "cocktail", label: "칵테일", order: 4},
		{id: "non-alcohol", label: "논알콜", order: 5},
	}
	for _, category := range categories {
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_categories (id, label, is_visible, sort_order)
			VALUES ($1, $2, TRUE, $3)
			ON CONFLICT (id) DO UPDATE
			SET label = EXCLUDED.label, is_visible = TRUE, sort_order = EXCLUDED.sort_order
		`, category.id, category.label, category.order); err != nil {
			return TossCatalogSyncResult{}, classifyError(err)
		}
	}
	rows, err := tx.Query(ctx, `
		SELECT id, name
		FROM menu_items
		WHERE toss_catalog_item_id IS NULL
		ORDER BY sort_order, id
	`)
	if err != nil {
		return TossCatalogSyncResult{}, err
	}
	unlinkedByName := make(map[string]string)
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			rows.Close()
			return TossCatalogSyncResult{}, err
		}
		normalized := normalizeCatalogItemName(name)
		if _, exists := unlinkedByName[normalized]; !exists {
			unlinkedByName[normalized] = id
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return TossCatalogSyncResult{}, err
	}
	rows.Close()

	if _, err := tx.Exec(ctx, `UPDATE menu_items SET is_visible = FALSE`); err != nil {
		return TossCatalogSyncResult{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM menu_options`); err != nil {
		return TossCatalogSyncResult{}, err
	}

	result := TossCatalogSyncResult{}
	for _, item := range items {
		item.ID = strings.TrimSpace(item.ID)
		item.Name = strings.TrimSpace(item.Name)
		item.Badge = strings.TrimSpace(item.Badge)
		item.CategoryID = strings.TrimSpace(item.CategoryID)
		if item.ID == "" || item.Name == "" || item.CategoryID == "" || item.Price < 0 {
			return TossCatalogSyncResult{}, ErrInvalidInput
		}

		price := formatWon(item.Price)
		localMenuItemID := ""
		tag, err := tx.Exec(ctx, `
			UPDATE menu_items
			SET category_id = $2,
				name = $3,
				price = $4,
				is_visible = $5,
				sort_order = $6,
				toss_image_url = $7,
				badge = COALESCE(NULLIF($8, ''), badge)
			WHERE toss_catalog_item_id = $1
		`, item.ID, item.CategoryID, item.Name, price, item.IsVisible, item.SortOrder, strings.TrimSpace(item.ImageURL), item.Badge)
		if err != nil {
			return TossCatalogSyncResult{}, classifyError(err)
		}
		if tag.RowsAffected() > 0 {
			if err := tx.QueryRow(ctx, `SELECT id FROM menu_items WHERE toss_catalog_item_id = $1`, item.ID).Scan(&localMenuItemID); err != nil {
				return TossCatalogSyncResult{}, classifyError(err)
			}
			result.Updated++
		} else if localID, ok := unlinkedByName[normalizeCatalogItemName(item.Name)]; ok {
			if _, err := tx.Exec(ctx, `
				UPDATE menu_items
				SET toss_catalog_item_id = $2,
					category_id = $3,
					name = $4,
					price = $5,
					is_visible = $6,
					sort_order = $7,
					toss_image_url = $8,
					badge = COALESCE(NULLIF($9, ''), badge)
				WHERE id = $1
			`, localID, item.ID, item.CategoryID, item.Name, price, item.IsVisible, item.SortOrder, strings.TrimSpace(item.ImageURL), item.Badge); err != nil {
				return TossCatalogSyncResult{}, classifyError(err)
			}
			localMenuItemID = localID
			delete(unlinkedByName, normalizeCatalogItemName(item.Name))
			result.Linked++
		} else {
			localMenuItemID = "toss-" + item.ID
			if _, err := tx.Exec(ctx, `
			INSERT INTO menu_items (
				id, category_id, badge, name, description, price, is_visible, sort_order, toss_catalog_item_id, toss_image_url
			) VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (id) DO UPDATE
			SET category_id = EXCLUDED.category_id,
				badge = COALESCE(EXCLUDED.badge, menu_items.badge),
				name = EXCLUDED.name,
				price = EXCLUDED.price,
				is_visible = EXCLUDED.is_visible,
				sort_order = EXCLUDED.sort_order,
				toss_catalog_item_id = EXCLUDED.toss_catalog_item_id,
				toss_image_url = EXCLUDED.toss_image_url
		`, localMenuItemID, item.CategoryID, item.Badge, item.Name, strings.TrimSpace(item.Description), price, item.IsVisible, item.SortOrder, item.ID, strings.TrimSpace(item.ImageURL)); err != nil {
				return TossCatalogSyncResult{}, classifyError(err)
			}
			result.Created++
		}

		if err := syncTossCatalogOptions(ctx, tx, localMenuItemID, item.Options); err != nil {
			return TossCatalogSyncResult{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return TossCatalogSyncResult{}, err
	}
	return result, nil
}

func syncTossCatalogOptions(ctx context.Context, tx pgx.Tx, menuItemID string, options []TossCatalogOption) error {
	for _, option := range options {
		if !option.Enabled || strings.TrimSpace(option.ID) == "" || strings.TrimSpace(option.Title) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_options (id, title, is_enabled, is_required, min_choices, max_choices, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (id) DO UPDATE SET
				title = EXCLUDED.title,
				is_enabled = EXCLUDED.is_enabled,
				is_required = EXCLUDED.is_required,
				min_choices = EXCLUDED.min_choices,
				max_choices = EXCLUDED.max_choices,
				sort_order = EXCLUDED.sort_order
		`, option.ID, strings.TrimSpace(option.Title), option.Enabled, option.Required, option.MinChoices, option.MaxChoices, option.SortOrder); err != nil {
			return classifyError(err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_item_options (menu_item_id, option_id, sort_order)
			VALUES ($1, $2, $3)
			ON CONFLICT (menu_item_id, option_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
		`, menuItemID, option.ID, option.SortOrder); err != nil {
			return classifyError(err)
		}
		for _, choice := range option.Choices {
			if strings.TrimSpace(choice.ID) == "" || strings.TrimSpace(choice.Title) == "" {
				continue
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO menu_option_choices (
					id, option_id, title, price_value, image_url, is_enabled, state,
					quantity_enabled, min_quantity, max_quantity, sort_order
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				ON CONFLICT (id) DO UPDATE SET
					option_id = EXCLUDED.option_id,
					title = EXCLUDED.title,
					price_value = EXCLUDED.price_value,
					image_url = EXCLUDED.image_url,
					is_enabled = EXCLUDED.is_enabled,
					state = EXCLUDED.state,
					quantity_enabled = EXCLUDED.quantity_enabled,
					min_quantity = EXCLUDED.min_quantity,
					max_quantity = EXCLUDED.max_quantity,
					sort_order = EXCLUDED.sort_order
			`, choice.ID, option.ID, strings.TrimSpace(choice.Title), choice.PriceValue,
				strings.TrimSpace(choice.ImageURL), choice.Enabled, choice.State,
				choice.QuantityEnabled, choice.MinQuantity, choice.MaxQuantity, choice.SortOrder); err != nil {
				return classifyError(err)
			}
		}
	}
	return nil
}

func normalizeCatalogItemName(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return unicode.ToLower(r)
	}, strings.TrimSpace(value))
}

func formatWon(amount int64) string {
	digits := strconv.FormatInt(amount, 10)
	for index := len(digits) - 3; index > 0; index -= 3 {
		digits = digits[:index] + "," + digits[index:]
	}
	return fmt.Sprintf("%s원", digits)
}
