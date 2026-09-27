package possync

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/her9797/laam/laam-api/internal/tossplace"
)

// RowRef is a payment_orders row as the completion planner sees it.
type RowRef struct {
	ID           string
	POSOrderID   string // POS order the row is currently linked to
	MenuItemName string
	Amount       int64 // our menu row amount incl. options
	CreatedAt    time.Time
	MovedOut     bool // already known to have left its POS order
}

// CompletionPlan is what to do with our rows when a POS order completes.
type CompletionPlan struct {
	CompleteRowIDs []string     // rows on this POS order still present in its final lines → DONE here
	MoveOutRowIDs  []string     // rows on this POS order whose item is no longer in its final lines
	AdoptRowIDs    []string     // rows linked to another POS order whose item moved into this one
	Natives        []NativeLine // remaining final lines no row represents (rung on POS)
}

// StillOnOrigin reports whether row's item is still on the POS order it is linked to (row.POSOrderID).
type StillOnOrigin func(ctx context.Context, row RowRef) (bool, error)

// errNoOriginLookup is returned when adoption needs a StillOnOrigin answer
// but the caller supplied none.
var errNoOriginLookup = errors.New("possync: stillOnOrigin lookup is required to adopt a row")

// unitLine is one matchable unit of a POS line item: a web row always
// represents a single unit, so a quantity-q line is split into q units when
// its amount divides evenly.
type unitLine struct {
	line   int // index into the positive lines
	name   string
	amount int64
}

// PlanCompletion decides, for a POS order that just completed with the given
// final line items, which of our rows are done on it, which have left it,
// which rows from other POS orders moved into it, and which lines were rung
// directly on the POS.
//
// TossPlace line items carry no reference to the order they were first
// added to ("한 번에 결제" can move an item between POS orders), so matching
// is by multiset:
//
//  1. onOrder rows are matched to unit lines by name and amount, then to
//     whole quantity lines by name and line total (a POS-native row
//     recorded for that line earlier), then by
//     amount alone (web names can differ from POS catalog titles). Matched
//     rows complete here; the rest moved out.
//  2. Each unit line still unmatched may adopt one candidate with the same
//     name and amount — MovedOut candidates first, otherwise only one whose
//     item stillOnOrigin says is gone from its POS order; oldest first.
//     A lookup error is returned as-is so the caller can retry.
//  3. Unit lines left over become Natives, recombined per original line.
//
// Row ids come out ordered by CreatedAt then ID; Natives follow line order.
func PlanCompletion(ctx context.Context, lines []tossplace.OrderLineItem, onOrder []RowRef, candidates []RowRef, stillOnOrigin StillOnOrigin) (CompletionPlan, error) {
	type positiveLine struct {
		name     string
		category string
	}
	positives := make([]positiveLine, 0, len(lines))
	units := make([]unitLine, 0, len(lines))
	for _, line := range lines {
		count, unitAmount, ok := lineUnits(line)
		if !ok {
			continue
		}
		index := len(positives)
		positives = append(positives, positiveLine{name: line.Item.Title, category: line.Item.Category.Title})
		for u := int64(0); u < count; u++ {
			units = append(units, unitLine{line: index, name: line.Item.Title, amount: unitAmount})
		}
	}
	matched := make([]bool, len(units))

	// Step 1: rows already linked to this POS order.
	own := sortedRows(onOrder)
	ownUsed := make([]bool, len(own))
	matchOwn := func(sameName bool) {
		for i, unit := range units {
			if matched[i] {
				continue
			}
			for j, row := range own {
				if ownUsed[j] || row.Amount != unit.amount || (sameName && row.MenuItemName != unit.name) {
					continue
				}
				ownUsed[j] = true
				matched[i] = true
				break
			}
		}
	}
	// A quantity line recorded earlier as one POS-native row (its units
	// recombined, see step 3) is represented by that row as a whole.
	matchWholeLines := func() {
		for start := 0; start < len(units); {
			end := start
			var total int64
			free := true
			for end < len(units) && units[end].line == units[start].line {
				total += units[end].amount
				free = free && !matched[end]
				end++
			}
			if free && end-start > 1 {
				for j, row := range own {
					if ownUsed[j] || row.Amount != total || row.MenuItemName != units[start].name {
						continue
					}
					ownUsed[j] = true
					for i := start; i < end; i++ {
						matched[i] = true
					}
					break
				}
			}
			start = end
		}
	}
	matchOwn(true)
	matchWholeLines()
	matchOwn(false)

	plan := CompletionPlan{
		CompleteRowIDs: make([]string, 0),
		MoveOutRowIDs:  make([]string, 0),
		AdoptRowIDs:    make([]string, 0),
		Natives:        make([]NativeLine, 0),
	}
	ownIDs := make(map[string]bool, len(own))
	for j, row := range own {
		ownIDs[row.ID] = true
		if ownUsed[j] {
			plan.CompleteRowIDs = append(plan.CompleteRowIDs, row.ID)
		} else {
			plan.MoveOutRowIDs = append(plan.MoveOutRowIDs, row.ID)
		}
	}

	// Step 2: adopt rows whose item moved here from another POS order.
	others := make([]RowRef, 0, len(candidates))
	for _, row := range sortedRows(candidates) {
		if !ownIDs[row.ID] {
			others = append(others, row)
		}
	}
	adopted := make([]bool, len(others))
	gone := make(map[string]bool)
	isGone := func(row RowRef) (bool, error) {
		if result, ok := gone[row.ID]; ok {
			return result, nil
		}
		if stillOnOrigin == nil {
			return false, errNoOriginLookup
		}
		still, err := stillOnOrigin(ctx, row)
		if err != nil {
			return false, err
		}
		gone[row.ID] = !still
		return !still, nil
	}
	for i, unit := range units {
		if matched[i] {
			continue
		}
		pick := -1
		for j, row := range others {
			if !adopted[j] && row.MovedOut && row.MenuItemName == unit.name && row.Amount == unit.amount {
				pick = j
				break
			}
		}
		if pick < 0 {
			for j, row := range others {
				if adopted[j] || row.MovedOut || row.MenuItemName != unit.name || row.Amount != unit.amount {
					continue
				}
				ok, err := isGone(row)
				if err != nil {
					return CompletionPlan{}, err
				}
				if ok {
					pick = j
					break
				}
			}
		}
		if pick >= 0 {
			adopted[pick] = true
			matched[i] = true
		}
	}
	for j, row := range others {
		if adopted[j] {
			plan.AdoptRowIDs = append(plan.AdoptRowIDs, row.ID)
		}
	}

	// Step 3: whatever is left was rung directly on the POS.
	leftover := make([]int64, len(positives))
	hasLeftover := make([]bool, len(positives))
	for i, unit := range units {
		if !matched[i] {
			leftover[unit.line] += unit.amount
			hasLeftover[unit.line] = true
		}
	}
	for index, line := range positives {
		if hasLeftover[index] {
			plan.Natives = append(plan.Natives, NativeLine{
				MenuItemName: line.name,
				CategoryName: line.category,
				Amount:       leftover[index],
			})
		}
	}
	return plan, nil
}

// lineUnits splits a POS line item into the units a web row can match: a
// quantity-q line whose amount (priceValue*quantity plus its option
// choices) divides evenly is q units of amount/q, otherwise one unit of the
// whole amount. ok is false for a line with a non-positive amount.
func lineUnits(line tossplace.OrderLineItem) (count int64, unitAmount int64, ok bool) {
	amount := line.ItemPrice.PriceValue * line.Quantity
	for _, choice := range line.OptionChoices {
		amount += choice.PriceValue * choice.Quantity
	}
	if amount <= 0 {
		return 0, 0, false
	}
	if line.Quantity > 1 && amount%line.Quantity == 0 {
		return line.Quantity, amount / line.Quantity, true
	}
	return 1, amount, true
}

// sortedRows returns a copy of rows ordered oldest first, ties by ID.
func sortedRows(rows []RowRef) []RowRef {
	sorted := append([]RowRef(nil), rows...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if !sorted[i].CreatedAt.Equal(sorted[j].CreatedAt) {
			return sorted[i].CreatedAt.Before(sorted[j].CreatedAt)
		}
		return sorted[i].ID < sorted[j].ID
	})
	return sorted
}
