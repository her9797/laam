package store

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/her9797/laam/laam-api/internal/lamdata"
)

const (
	maxMenuLabelTextRunes           = 20
	maxMenuDescriptionOverrideRunes = 300
	maxMenuItemLabels               = 5
	defaultMenuLabelColor           = "green"
)

// normalizeMenuLabel trims the label text and defaults an empty color to
// green; it rejects text outside 1..20 runes and colors outside
// lamdata.MenuLabelColors.
func normalizeMenuLabel(text string, color string) (string, string, error) {
	text = strings.TrimSpace(text)
	color = strings.TrimSpace(color)
	if color == "" {
		color = defaultMenuLabelColor
	}
	if text == "" || utf8.RuneCountInString(text) > maxMenuLabelTextRunes || !lamdata.IsMenuLabelColor(color) {
		return "", "", ErrInvalidInput
	}
	return text, color, nil
}

// CreateMenuLabel adds an operator-managed label at the end of the list.
// Text is unique case-insensitively (idx_menu_labels_text → ErrAlreadyExists).
func (r *Repository) CreateMenuLabel(ctx context.Context, text string, color string) error {
	text, color, err := normalizeMenuLabel(text, color)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO menu_labels (id, text, color, sort_order)
		SELECT $1, $2, $3, COALESCE(MAX(sort_order), 0) + 1 FROM menu_labels
	`, nextID("label"), text, color)
	return classifyError(err)
}

func (r *Repository) UpdateMenuLabel(ctx context.Context, id string, text string, color string) error {
	text, color, err := normalizeMenuLabel(text, color)
	if err != nil {
		return err
	}
	tag, err := r.pool.Exec(ctx, `UPDATE menu_labels SET text = $2, color = $3 WHERE id = $1`, id, text, color)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteMenuLabel removes a label; its menu item assignments go with it
// (menu_item_labels ON DELETE CASCADE).
func (r *Repository) DeleteMenuLabel(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM menu_labels WHERE id = $1`, id)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateMenuItemContent sets the operator description override ("" clears
// it to NULL) and replaces the item's label assignments with labelIDs in
// order, all in one transaction. Catalog sync never writes either, so they
// survive every Toss resync.
func (r *Repository) UpdateMenuItemContent(ctx context.Context, id string, descriptionOverride string, labelIDs []string) error {
	descriptionOverride = strings.TrimSpace(descriptionOverride)
	if utf8.RuneCountInString(descriptionOverride) > maxMenuDescriptionOverrideRunes || len(labelIDs) > maxMenuItemLabels {
		return ErrInvalidInput
	}
	ids := make([]string, 0, len(labelIDs))
	seen := make(map[string]bool, len(labelIDs))
	for _, labelID := range labelIDs {
		labelID = strings.TrimSpace(labelID)
		if labelID == "" || seen[labelID] {
			return ErrInvalidInput
		}
		seen[labelID] = true
		ids = append(ids, labelID)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `UPDATE menu_items SET description_override = $2 WHERE id = $1`, id, nullable(descriptionOverride))
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM menu_item_labels WHERE menu_item_id = $1`, id); err != nil {
		return err
	}
	// The join drops unknown label ids, so a short row count means at least
	// one id does not exist.
	tag, err = tx.Exec(ctx, `
		INSERT INTO menu_item_labels (menu_item_id, label_id, sort_order)
		SELECT $1, l.id, ids.ord - 1
		FROM unnest($2::text[]) WITH ORDINALITY AS ids(id, ord)
		JOIN menu_labels l ON l.id = ids.id
	`, id, ids)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() != int64(len(ids)) {
		return ErrInvalidInput
	}
	return tx.Commit(ctx)
}
