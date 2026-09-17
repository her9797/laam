package lamdata

// ExpenseCategory classifies both inventory items and non-item receipt
// lines. The six seeded defaults (IsDefault) use fixed slug ids.
type ExpenseCategory struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
	IsDefault bool   `json:"isDefault"`
}

type InventoryItem struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	CategoryID    string `json:"categoryId"`
	Unit          string `json:"unit"`
	Quantity      int    `json:"quantity"`
	MinQuantity   int    `json:"minQuantity"`
	IsArchived    bool   `json:"isArchived"`
	NeedsReorder  bool   `json:"needsReorder"`
	NeedsCheck    bool   `json:"needsCheck"`
	LastUnitPrice *int64 `json:"lastUnitPrice"`
	// LastPurchasedAt is the createdAt of the receipt holding the item's
	// most recent line (latest date, then latest createdAt).
	LastPurchasedAt *string `json:"lastPurchasedAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

type InventoryAdjustment struct {
	ID            string  `json:"id"`
	ItemID        string  `json:"itemId"`
	Delta         int     `json:"delta"`
	QuantityAfter int     `json:"quantityAfter"`
	Reason        string  `json:"reason"`
	ReceiptID     *string `json:"receiptId"`
	CreatedAt     string  `json:"createdAt"`
}

type ExpenseReceiptLine struct {
	ID          string  `json:"id"`
	ItemID      *string `json:"itemId"`
	ItemName    string  `json:"itemName"`
	CategoryID  string  `json:"categoryId"`
	Description string  `json:"description"`
	Quantity    *int    `json:"quantity"`
	Amount      int64   `json:"amount"`
}

type ExpenseReceipt struct {
	ID            string               `json:"id"`
	Date          string               `json:"date"`
	Vendor        string               `json:"vendor"`
	PaymentMethod string               `json:"paymentMethod"`
	Memo          string               `json:"memo"`
	Total         int64                `json:"total"`
	HasImage      bool                 `json:"hasImage"`
	Lines         []ExpenseReceiptLine `json:"lines"`
	CreatedAt     string               `json:"createdAt"`
	UpdatedAt     string               `json:"updatedAt"`
}

type ExpenseCategoryAmount struct {
	CategoryID string `json:"categoryId"`
	Name       string `json:"name"`
	Amount     int64  `json:"amount"`
}

type ExpenseSummary struct {
	Month              string                  `json:"month"`
	Total              int64                   `json:"total"`
	PreviousMonthTotal int64                   `json:"previousMonthTotal"`
	ReceiptCount       int                     `json:"receiptCount"`
	ByCategory         []ExpenseCategoryAmount `json:"byCategory"`
}

type InventorySummary struct {
	ReorderCount    int `json:"reorderCount"`
	NeedsCheckCount int `json:"needsCheckCount"`
}

type ExpenseReceiptImageURL struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
}
