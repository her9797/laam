package possync

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

// Move candidates are rows created from moveCandidateLookback before the
// completion until moveCandidateLookahead after it: an item can only move
// between POS orders that are open at the same time.
const (
	moveCandidateLookback  = 24 * time.Hour
	moveCandidateLookahead = 5 * time.Minute
)

const (
	rowStatusCancelled = "CANCELLED"
	rowStatusDone      = "DONE"
)

// CompletionReader is the read side of the store a completion is planned
// from. Both methods are plain SELECTs, so a read-only connection works.
type CompletionReader interface {
	ListPOSRowsOnOrder(ctx context.Context, posOrderID string) ([]store.POSRow, error)
	ListPOSMoveCandidates(ctx context.Context, posOrderID string, from, to time.Time) ([]store.POSRow, error)
}

// OrderFetcher fetches a POS order from TossPlace.
type OrderFetcher interface {
	GetOrder(ctx context.Context, orderID string) (tossplace.Order, error)
}

// OrderCompletion is the planned completion of one POS order.
type OrderCompletion struct {
	Plan CompletionPlan
	// Input applies Plan with store.Repository.ApplyPOSCompletion.
	Input store.ApplyPOSCompletionInput
	// RowsOnOrder counts every row linked to the POS order (any status,
	// moved out or not); zero means we had no record of the order at all.
	RowsOnOrder int
	// Rows holds every row the plan refers to by id: the rows on the order
	// and the move candidates.
	Rows map[string]store.POSRow
}

// PlanOrderCompletion plans the completion of posOrderID from its final
// TossPlace order (see PlanCompletion). Rows of other POS orders whose item
// may have moved in are checked against their origin's current lines,
// fetched through orders (once per origin). Any read or fetch error is
// returned so the caller can retry; nothing is guessed.
//
// A completed order reported with a positive charge but no positive line
// items is missing its lines rather than empty: its rows complete as they
// did before moves were tracked, and nothing moves or is adopted.
func PlanOrderCompletion(ctx context.Context, reader CompletionReader, orders OrderFetcher, posOrderID string, order tossplace.Order, completedAt time.Time) (OrderCompletion, error) {
	onOrderRows, err := reader.ListPOSRowsOnOrder(ctx, posOrderID)
	if err != nil {
		return OrderCompletion{}, fmt.Errorf("list rows on %q: %w", posOrderID, err)
	}
	result := OrderCompletion{RowsOnOrder: len(onOrderRows), Rows: map[string]store.POSRow{}}
	onOrder := make([]RowRef, 0, len(onOrderRows))
	for _, row := range onOrderRows {
		if row.Status == rowStatusCancelled || !row.MovedOutAt.IsZero() {
			continue
		}
		result.Rows[row.ID] = row
		onOrder = append(onOrder, refOf(row))
	}

	var plan CompletionPlan
	if !hasPositiveLine(order.LineItems) && order.ChargePrice.TotalAmount > 0 {
		plan = CompletionPlan{CompleteRowIDs: make([]string, 0), MoveOutRowIDs: make([]string, 0), AdoptRowIDs: make([]string, 0), Natives: make([]NativeLine, 0)}
		for _, row := range sortedRows(onOrder) {
			plan.CompleteRowIDs = append(plan.CompleteRowIDs, row.ID)
		}
	} else {
		candidateRows, err := reader.ListPOSMoveCandidates(ctx, posOrderID, completedAt.Add(-moveCandidateLookback), completedAt.Add(moveCandidateLookahead))
		if err != nil {
			return OrderCompletion{}, fmt.Errorf("list move candidates for %q: %w", posOrderID, err)
		}
		candidates := make([]RowRef, 0, len(candidateRows))
		for _, row := range candidateRows {
			result.Rows[row.ID] = row
			candidates = append(candidates, refOf(row))
		}
		plan, err = PlanCompletion(ctx, order.LineItems, onOrder, candidates, OriginLookup(reader, orders))
		if err != nil {
			return OrderCompletion{}, fmt.Errorf("plan completion of %q: %w", posOrderID, err)
		}
	}
	result.Plan = plan
	result.Input = completionInput(posOrderID, order, plan, completedAt)
	return result, nil
}

// OriginLookup answers StillOnOrigin by fetching the row's POS order and
// comparing its current lines with the rows still linked to it. Each origin
// is fetched and listed once per lookup instance.
func OriginLookup(reader CompletionReader, orders OrderFetcher) StillOnOrigin {
	cache := map[string]map[string]bool{}
	return func(ctx context.Context, row RowRef) (bool, error) {
		still, ok := cache[row.POSOrderID]
		if !ok {
			order, err := orders.GetOrder(ctx, row.POSOrderID)
			if err != nil {
				return false, fmt.Errorf("fetch origin POS order %q: %w", row.POSOrderID, err)
			}
			rows, err := reader.ListPOSRowsOnOrder(ctx, row.POSOrderID)
			if err != nil {
				return false, fmt.Errorf("list rows on origin %q: %w", row.POSOrderID, err)
			}
			if !hasPositiveLine(order.LineItems) && order.ChargePrice.TotalAmount > 0 {
				// Lines missing from the response: assume nothing left, as
				// that order's own completion will (see PlanOrderCompletion).
				still = map[string]bool{}
				for _, r := range rows {
					still[r.ID] = true
				}
			} else {
				still = rowsStillOnOrder(order.LineItems, rows)
			}
			cache[row.POSOrderID] = still
		}
		return still[row.ID], nil
	}
}

// rowsStillOnOrder returns the ids of the rows whose item is still among
// lines. Rows are matched by name and amount: for each such pair, the
// order's units (see lineUnits) are handed out to the live rows — DONE rows
// first (they were settled on the order), then oldest first — and the rows
// left without a unit have moved elsewhere. Cancelled and moved-out rows
// are never on the order.
func rowsStillOnOrder(lines []tossplace.OrderLineItem, rows []store.POSRow) map[string]bool {
	type key struct {
		name   string
		amount int64
	}
	units := map[key]int64{}
	for _, line := range lines {
		count, unitAmount, ok := lineUnits(line)
		if ok {
			units[key{line.Item.Title, unitAmount}] += count
		}
	}
	live := make([]store.POSRow, 0, len(rows))
	for _, row := range rows {
		if row.Status != rowStatusCancelled && row.MovedOutAt.IsZero() {
			live = append(live, row)
		}
	}
	sort.SliceStable(live, func(i, j int) bool {
		if doneI, doneJ := live[i].Status == rowStatusDone, live[j].Status == rowStatusDone; doneI != doneJ {
			return doneI
		}
		if !live[i].CreatedAt.Equal(live[j].CreatedAt) {
			return live[i].CreatedAt.Before(live[j].CreatedAt)
		}
		return live[i].ID < live[j].ID
	})
	still := map[string]bool{}
	for _, row := range live {
		k := key{row.MenuItemName, row.Amount}
		if units[k] > 0 {
			units[k]--
			still[row.ID] = true
		}
	}
	return still
}

func hasPositiveLine(lines []tossplace.OrderLineItem) bool {
	for _, line := range lines {
		if _, _, ok := lineUnits(line); ok {
			return true
		}
	}
	return false
}

func refOf(row store.POSRow) RowRef {
	return RowRef{
		ID:           row.ID,
		POSOrderID:   row.POSOrderID,
		MenuItemName: row.MenuItemName,
		Amount:       row.Amount,
		CreatedAt:    row.CreatedAt,
		MovedOut:     !row.MovedOutAt.IsZero(),
	}
}

// completionInput turns plan into ApplyPOSCompletion's input. POS-native
// rows are approved at the order's completedAt (else completedAt) and
// ordered at its openedAt when TossPlace reports it.
func completionInput(posOrderID string, order tossplace.Order, plan CompletionPlan, completedAt time.Time) store.ApplyPOSCompletionInput {
	approvedAt := completedAt
	if parsed := ParseTimestamp(order.CompletedAt); !parsed.IsZero() {
		approvedAt = parsed
	}
	orderedAt := ParseTimestamp(order.OpenedAt)
	natives := make([]store.CreatePOSNativeOrderInput, 0, len(plan.Natives))
	for _, native := range plan.Natives {
		vat := native.Amount / 11
		natives = append(natives, store.CreatePOSNativeOrderInput{
			MenuItemName:   native.MenuItemName,
			CategoryName:   native.CategoryName,
			Amount:         native.Amount,
			OrderedAt:      orderedAt,
			ApprovedAt:     approvedAt,
			VAT:            vat,
			SuppliedAmount: native.Amount - vat,
			POSOrderID:     posOrderID,
		})
	}
	total, discount := order.ChargePrice.TotalAmount, order.ChargePrice.DiscountAmount
	return store.ApplyPOSCompletionInput{
		POSOrderID:     posOrderID,
		CompletedAt:    completedAt,
		CompleteRowIDs: plan.CompleteRowIDs,
		MoveOutRowIDs:  plan.MoveOutRowIDs,
		AdoptRowIDs:    plan.AdoptRowIDs,
		Natives:        natives,
		TotalAmount:    &total,
		DiscountAmount: &discount,
	}
}
