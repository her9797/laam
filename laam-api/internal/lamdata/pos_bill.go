package lamdata

// POSBillPaymentSummary is one payment on a bill as shown in the admin bill
// list — just enough to render "카드 18,000 + 현금 10,000".
type POSBillPaymentSummary struct {
	SourceType    string `json:"sourceType"`
	PaymentMethod string `json:"paymentMethod"`
	Amount        int64  `json:"amount"`
	State         string `json:"state"`
}

// POSBill is one row of the admin bill list: a TossPlace (POS) order with
// the menu rows and payments recorded against it.
type POSBill struct {
	ID          string `json:"id"`
	POSOrderID  string `json:"posOrderId"`
	TableNumber string `json:"tableNumber"`
	Status      string `json:"status"`
	OpenedAt    string `json:"openedAt"`
	CompletedAt string `json:"completedAt,omitempty"`
	CancelledAt string `json:"cancelledAt,omitempty"`
	// TotalAmount is what the POS charged for the order when known,
	// otherwise the sum of the bill's non-cancelled menu rows.
	TotalAmount int64 `json:"totalAmount"`
	// PaidAmount is the sum of the bill's APPROVED payments.
	PaidAmount  int64                   `json:"paidAmount"`
	Payments    []POSBillPaymentSummary `json:"payments"`
	MenuCount   int                     `json:"menuCount"`
	MenuPreview []string                `json:"menuPreview"`
}

type POSBillPage struct {
	Items    []POSBill `json:"items"`
	Page     int       `json:"page"`
	PageSize int       `json:"pageSize"`
	Total    int       `json:"total"`
}

// POSPayment is one TossPlace payment in the admin bill detail.
type POSPayment struct {
	ID              string `json:"id"`
	State           string `json:"state"`
	SourceType      string `json:"sourceType"`
	PaymentMethod   string `json:"paymentMethod"`
	CardBrand       string `json:"cardBrand,omitempty"`
	Amount          int64  `json:"amount"`
	TaxAmount       int64  `json:"taxAmount"`
	SupplyAmount    int64  `json:"supplyAmount"`
	TaxExemptAmount int64  `json:"taxExemptAmount"`
	ApprovedNo      string `json:"approvedNo,omitempty"`
	ApprovedAt      string `json:"approvedAt,omitempty"`
	CancelledAt     string `json:"cancelledAt,omitempty"`
}

// POSBillDetail is the admin bill detail: the bill, every payment on it and
// every menu row on it (in the admin payment-order read shape).
type POSBillDetail struct {
	ID          string `json:"id"`
	POSOrderID  string `json:"posOrderId"`
	TableNumber string `json:"tableNumber"`
	Status      string `json:"status"`
	OpenedAt    string `json:"openedAt"`
	CompletedAt string `json:"completedAt,omitempty"`
	CancelledAt string `json:"cancelledAt,omitempty"`
	TotalAmount int64  `json:"totalAmount"`
	PaidAmount  int64  `json:"paidAmount"`
	// DiscountAmount is the POS order-level discount, null until the POS
	// charge has been recorded.
	DiscountAmount *int64 `json:"discountAmount"`
	// PaymentsSyncedAt is set once the bill's full payment list has been
	// fetched from TossPlace; until then Payments may be incomplete.
	PaymentsSyncedAt string         `json:"paymentsSyncedAt,omitempty"`
	Payments         []POSPayment   `json:"payments"`
	MenuItems        []PaymentOrder `json:"menuItems"`
}
