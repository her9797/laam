package store

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/her9797/laam/laam-api/internal/lamdata"
)

const (
	maxMenuLabelTextRunes           = 20
	maxMenuDescriptionOverrideRunes = 300
	maxMenuItemLabels               = 5
)

// UpdateMenuItemContent sets the operator description override ("" clears
// it to NULL) and replaces the item's free-text labels with labels in order.
// Each label is trimmed; text must be 1..20 runes and unique within the item
// case-insensitively, and color one of lamdata.MenuLabelColors (empty is
// rejected so a missing color never turns into a default). Catalog sync never
// writes either column, so they survive every Toss resync.
func (r *Repository) UpdateMenuItemContent(ctx context.Context, id string, descriptionOverride string, labels []lamdata.MenuItemLabel) error {
	descriptionOverride = strings.TrimSpace(descriptionOverride)
	if utf8.RuneCountInString(descriptionOverride) > maxMenuDescriptionOverrideRunes || len(labels) > maxMenuItemLabels {
		return ErrInvalidInput
	}
	normalized := make([]lamdata.MenuItemLabel, 0, len(labels))
	seen := make(map[string]bool, len(labels))
	for _, label := range labels {
		text, color := strings.TrimSpace(label.Text), strings.TrimSpace(label.Color)
		key := strings.ToLower(text)
		if text == "" || utf8.RuneCountInString(text) > maxMenuLabelTextRunes || !lamdata.IsMenuLabelColor(color) || seen[key] {
			return ErrInvalidInput
		}
		seen[key] = true
		normalized = append(normalized, lamdata.MenuItemLabel{Text: text, Color: color})
	}
	labelsJSON, err := json.Marshal(normalized)
	if err != nil {
		return err
	}

	tag, err := r.pool.Exec(ctx, `UPDATE menu_items SET description_override = $2, custom_labels = $3::jsonb WHERE id = $1`, id, nullable(descriptionOverride), string(labelsJSON))
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
