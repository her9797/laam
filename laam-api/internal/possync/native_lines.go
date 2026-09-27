// Package possync applies TossPlace order and payment events to the
// bills (pos_bills), payments (pos_payments) and orders (payment_orders)
// stored by the store package. The webhook handlers call it; so can a
// one-off backfill, since it only needs a repository and an Open API client.
package possync

// NativeLine is one TossPlace line item that no payment_orders row
// represents yet — it was rung up directly on the POS. Its amount is
// priceValue*quantity plus its option choices (see PlanCompletion).
type NativeLine struct {
	MenuItemName string
	CategoryName string
	Amount       int64
}
