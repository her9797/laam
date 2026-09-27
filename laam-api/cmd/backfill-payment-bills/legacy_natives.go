package main

import (
	"context"
	"sort"

	"github.com/her9797/laam/laam-api/internal/possync"
	"github.com/her9797/laam/laam-api/internal/store"
)

// planLegacyNativeReplacements finds legacy duplicates on a completed POS
// order P. Before moves were tracked, a web item moved to P from another POS
// order by "한 번에 결제" was recorded again on P as a POS-native row
// (menu_item_id NULL, DONE) while the web row stayed unpaid on its origin.
// The planner then matches P's line to that native row, so the web row would
// never be adopted and stay unpaid forever.
//
// For each native row the plan completes on P (oldest first) it picks the
// oldest unused web row — menu item set, READY/ACKNOWLEDGED, on another POS
// order, not already adopted, same menu name and amount — that has
// confirmably left its origin: already marked moved out, or stillOnOrigin
// says its item is no longer there. Each native and each web row is paired
// at most once. A lookup error is returned so the order can be retried.
//
// This is backfill-only legacy cleanup; the completed webhook never calls it.
func planLegacyNativeReplacements(ctx context.Context, completion possync.OrderCompletion, stillOnOrigin possync.StillOnOrigin) ([]store.POSNativeReplacement, error) {
	posOrderID := completion.Input.POSOrderID
	adopted := map[string]bool{}
	for _, id := range completion.Plan.AdoptRowIDs {
		adopted[id] = true
	}

	webs := make([]store.POSRow, 0)
	for _, row := range completion.Rows {
		if row.POSOrderID != posOrderID && row.MenuItemID != "" && isUnpaid(row.Status) && !adopted[row.ID] {
			webs = append(webs, row)
		}
	}
	if len(webs) == 0 {
		return nil, nil
	}
	sort.Slice(webs, func(i, j int) bool {
		if !webs[i].CreatedAt.Equal(webs[j].CreatedAt) {
			return webs[i].CreatedAt.Before(webs[j].CreatedAt)
		}
		return webs[i].ID < webs[j].ID
	})

	natives := make([]store.POSRow, 0)
	for _, id := range completion.Plan.CompleteRowIDs {
		row, ok := completion.Rows[id]
		if ok && row.POSOrderID == posOrderID && row.MenuItemID == "" && row.Status == "DONE" && row.MovedOutAt.IsZero() {
			natives = append(natives, row)
		}
	}
	sort.SliceStable(natives, func(i, j int) bool {
		if !natives[i].CreatedAt.Equal(natives[j].CreatedAt) {
			return natives[i].CreatedAt.Before(natives[j].CreatedAt)
		}
		return natives[i].ID < natives[j].ID
	})

	used := make([]bool, len(webs))
	moved := map[string]bool{}
	hasMoved := func(row store.POSRow) (bool, error) {
		if !row.MovedOutAt.IsZero() {
			return true, nil
		}
		if result, ok := moved[row.ID]; ok {
			return result, nil
		}
		still, err := stillOnOrigin(ctx, possync.RowRef{
			ID: row.ID, POSOrderID: row.POSOrderID, MenuItemName: row.MenuItemName, Amount: row.Amount, CreatedAt: row.CreatedAt,
		})
		if err != nil {
			return false, err
		}
		moved[row.ID] = !still
		return !still, nil
	}

	pairs := make([]store.POSNativeReplacement, 0)
	for _, native := range natives {
		for j, web := range webs {
			if used[j] || web.MenuItemName != native.MenuItemName || web.Amount != native.Amount {
				continue
			}
			ok, err := hasMoved(web)
			if err != nil {
				return nil, err
			}
			if ok {
				used[j] = true
				pairs = append(pairs, store.POSNativeReplacement{NativeRowID: native.ID, WebRowID: web.ID})
				break
			}
		}
	}
	return pairs, nil
}
