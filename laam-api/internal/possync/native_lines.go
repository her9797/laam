// Package possync applies TossPlace order and payment events to the
// bills (pos_bills), payments (pos_payments) and orders (payment_orders)
// stored by the store package. The webhook handlers call it; so can a
// one-off backfill, since it only needs a repository and an Open API client.
package possync

import (
	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

// NativeLine is one TossPlace line item that no payment_orders row
// represents yet — it was rung up directly on the POS.
type NativeLine struct {
	MenuItemName string
	CategoryName string
	Amount       int64
}

// NativeLines diffs a POS order's line items against the payment_orders
// rows already recorded for it and returns the lines left over.
//
// TossPlace line items carry no reference back to our order ids, so the
// diff is a multiset match: first by name and amount, then — for web orders
// whose menu name differs from the POS catalog title — by amount alone.
// Each line's amount is priceValue*quantity plus its option choices,
// matching how CreatePOSNativeOrder has always recorded POS-native sales.
// Lines with a non-positive amount are never recorded.
func NativeLines(lines []tossplace.OrderLineItem, existing []store.POSOrderLine) []NativeLine {
	candidates := make([]NativeLine, 0, len(lines))
	for _, line := range lines {
		amount := line.ItemPrice.PriceValue * line.Quantity
		for _, choice := range line.OptionChoices {
			amount += choice.PriceValue * choice.Quantity
		}
		if amount <= 0 {
			continue
		}
		candidates = append(candidates, NativeLine{
			MenuItemName: line.Item.Title,
			CategoryName: line.Item.Category.Title,
			Amount:       amount,
		})
	}

	used := make([]bool, len(existing))
	matched := make([]bool, len(candidates))
	match := func(sameName bool) {
		for i, candidate := range candidates {
			if matched[i] {
				continue
			}
			for j, row := range existing {
				if used[j] || row.Amount != candidate.Amount || (sameName && row.MenuItemName != candidate.MenuItemName) {
					continue
				}
				used[j] = true
				matched[i] = true
				break
			}
		}
	}
	match(true)
	match(false)

	natives := make([]NativeLine, 0)
	for i, candidate := range candidates {
		if !matched[i] {
			natives = append(natives, candidate)
		}
	}
	return natives
}
