package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

type adminBillSeed struct {
	ID             string
	TableNumber    string
	Status         string
	OpenedAt       time.Time
	CompletedAt    *time.Time
	CancelledAt    *time.Time
	TotalAmount    *int64
	DiscountAmount *int64
	Synced         bool
}

func seedAdminBill(t *testing.T, ctx context.Context, b adminBillSeed) {
	t.Helper()
	var syncedAt *time.Time
	if b.Synced {
		syncedAt = &b.OpenedAt
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO pos_bills (
			id, pos_order_id, table_number, status, opened_at, completed_at, cancelled_at,
			total_amount, discount_amount, payments_synced_at
		) VALUES ($1, 'pos-' || $1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, b.ID, b.TableNumber, b.Status, b.OpenedAt, b.CompletedAt, b.CancelledAt,
		b.TotalAmount, b.DiscountAmount, syncedAt); err != nil {
		t.Fatalf("seed pos_bills %q: %v", b.ID, err)
	}
}

func seedAdminBillMenu(t *testing.T, ctx context.Context, id string, billID string, name string, amount int64, status string, createdAt time.Time) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status, pos_sync_status,
			pos_order_id, bill_id, created_at
		)
		SELECT $1, $2, 'Drinks', b.table_number, $3, $4, 'SUCCEEDED', b.pos_order_id, b.id, $5
		FROM pos_bills b WHERE b.id = $6
	`, id, name, amount, status, createdAt, billID); err != nil {
		t.Fatalf("seed payment_orders %q: %v", id, err)
	}
}

type adminPaymentSeed struct {
	ID          string
	BillID      string
	State       string
	SourceType  string
	CardBrand   string
	Amount      int64
	ApprovedNo  string
	ApprovedAt  time.Time
	CancelledAt *time.Time
}

func seedAdminBillPayment(t *testing.T, ctx context.Context, p adminPaymentSeed) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO pos_payments (
			id, bill_id, state, source_type, payment_method, card_brand, amount,
			tax_amount, supply_amount, approved_no, approved_at, cancelled_at
		) VALUES ($1, $2, $3, $4, $4, $5, $6::bigint, $6::bigint / 11, $6::bigint - $6::bigint / 11, $7, $8, $9)
	`, p.ID, p.BillID, p.State, p.SourceType, p.CardBrand, p.Amount, p.ApprovedNo, p.ApprovedAt, p.CancelledAt); err != nil {
		t.Fatalf("seed pos_payments %q: %v", p.ID, err)
	}
}

func adminBillInt64(v int64) *int64 { return &v }

func adminBillTime(v time.Time) *time.Time { return &v }

// seedAdminBillFixture creates three bills:
//
//   - bill-1 (PAID, T-03, opened 2026-01-10 20:00 KST, synced): Beer 10,000,
//     Pizza 20,000, Fries 5,000 (CANCELLED), Soda 3,000 on the menu; the POS
//     charged 28,000 after a 5,000 discount, paid CARD 18,000 + CASH
//     10,000 after a CANCELLED CARD 18,000 attempt.
//   - bill-2 (OPEN, B-01, opened 2026-01-11 19:00 KST): Highball 9,000 and
//     Nachos 7,000 (CANCELLED), nothing paid, no POS charge yet.
//   - bill-3 (CANCELLED, T-03, opened 2026-01-09 18:00 KST): one 5,000 row
//     and a CASH 5,000 payment that was CANCELLED.
func seedAdminBillFixture(t *testing.T, ctx context.Context) {
	t.Helper()
	opened1 := time.Date(2026, 1, 10, 20, 0, 0, 0, kst)
	seedAdminBill(t, ctx, adminBillSeed{
		ID: "bill-1", TableNumber: "T-03", Status: "PAID", OpenedAt: opened1,
		CompletedAt: adminBillTime(opened1.Add(2 * time.Hour)),
		TotalAmount: adminBillInt64(28000), DiscountAmount: adminBillInt64(5000), Synced: true,
	})
	seedAdminBillMenu(t, ctx, "bill-1-beer", "bill-1", "Beer", 10000, "DONE", opened1)
	seedAdminBillMenu(t, ctx, "bill-1-pizza", "bill-1", "Pizza", 20000, "DONE", opened1.Add(time.Minute))
	seedAdminBillMenu(t, ctx, "bill-1-fries", "bill-1", "Fries", 5000, "CANCELLED", opened1.Add(2*time.Minute))
	seedAdminBillMenu(t, ctx, "bill-1-soda", "bill-1", "Soda", 3000, "DONE", opened1.Add(3*time.Minute))
	seedAdminBillPayment(t, ctx, adminPaymentSeed{
		ID: "pay-1-void", BillID: "bill-1", State: "CANCELLED", SourceType: "CARD", CardBrand: "BC",
		Amount: 18000, ApprovedNo: "A0", ApprovedAt: opened1.Add(100 * time.Minute),
		CancelledAt: adminBillTime(opened1.Add(105 * time.Minute)),
	})
	seedAdminBillPayment(t, ctx, adminPaymentSeed{
		ID: "pay-1-card", BillID: "bill-1", State: "APPROVED", SourceType: "CARD", CardBrand: "BC",
		Amount: 18000, ApprovedNo: "A1", ApprovedAt: opened1.Add(110 * time.Minute),
	})
	seedAdminBillPayment(t, ctx, adminPaymentSeed{
		ID: "pay-1-cash", BillID: "bill-1", State: "APPROVED", SourceType: "CASH",
		Amount: 10000, ApprovedAt: opened1.Add(115 * time.Minute),
	})

	opened2 := time.Date(2026, 1, 11, 19, 0, 0, 0, kst)
	seedAdminBill(t, ctx, adminBillSeed{ID: "bill-2", TableNumber: "B-01", Status: "OPEN", OpenedAt: opened2})
	seedAdminBillMenu(t, ctx, "bill-2-highball", "bill-2", "Highball", 9000, "READY", opened2)
	seedAdminBillMenu(t, ctx, "bill-2-nachos", "bill-2", "Nachos", 7000, "CANCELLED", opened2.Add(time.Minute))

	opened3 := time.Date(2026, 1, 9, 18, 0, 0, 0, kst)
	seedAdminBill(t, ctx, adminBillSeed{
		ID: "bill-3", TableNumber: "T-03", Status: "CANCELLED", OpenedAt: opened3,
		CancelledAt: adminBillTime(opened3.Add(time.Hour)), Synced: true,
	})
	seedAdminBillMenu(t, ctx, "bill-3-beer", "bill-3", "Beer", 5000, "CANCELLED", opened3)
	seedAdminBillPayment(t, ctx, adminPaymentSeed{
		ID: "pay-3-cash", BillID: "bill-3", State: "CANCELLED", SourceType: "CASH",
		Amount: 5000, ApprovedAt: opened3.Add(10 * time.Minute), CancelledAt: adminBillTime(opened3.Add(time.Hour)),
	})
}

func billIDs(t *testing.T, repo *Repository, filter POSBillFilter) ([]string, int) {
	t.Helper()
	items, total, err := repo.ListPOSBillsPage(context.Background(), filter)
	if err != nil {
		t.Fatalf("ListPOSBillsPage(%+v) error = %v", filter, err)
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids, total
}

func TestRepository_ListPOSBillsPage_SummarizesEachBillNewestFirst(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	seedAdminBillFixture(t, ctx)

	items, total, err := repo.ListPOSBillsPage(ctx, POSBillFilter{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListPOSBillsPage() error = %v", err)
	}
	if total != 3 || len(items) != 3 {
		t.Fatalf("total/len = %d/%d, want 3/3", total, len(items))
	}
	if items[0].ID != "bill-2" || items[1].ID != "bill-1" || items[2].ID != "bill-3" {
		t.Fatalf("order = %s,%s,%s, want bill-2,bill-1,bill-3 (opened_at DESC)", items[0].ID, items[1].ID, items[2].ID)
	}

	paid := items[1]
	if paid.POSOrderID != "pos-bill-1" || paid.TableNumber != "T-03" || paid.Status != "PAID" {
		t.Errorf("bill-1 identity = %+v", paid)
	}
	if paid.OpenedAt != "2026-01-10T11:00:00Z" || paid.CompletedAt != "2026-01-10T13:00:00Z" || paid.CancelledAt != "" {
		t.Errorf("bill-1 times = %q/%q/%q", paid.OpenedAt, paid.CompletedAt, paid.CancelledAt)
	}
	if paid.TotalAmount != 28000 || paid.PaidAmount != 28000 {
		t.Errorf("bill-1 total/paid = %d/%d, want 28000/28000 (POS charge, approved payments)", paid.TotalAmount, paid.PaidAmount)
	}
	if paid.MenuCount != 4 || !reflect.DeepEqual(paid.MenuPreview, []string{"Beer", "Pizza", "Fries"}) {
		t.Errorf("bill-1 menu = %d %v, want 4 [Beer Pizza Fries]", paid.MenuCount, paid.MenuPreview)
	}
	if len(paid.Payments) != 3 {
		t.Fatalf("bill-1 payments = %+v, want 3", paid.Payments)
	}
	wantPayments := [][3]string{{"CARD", "CANCELLED"}, {"CARD", "APPROVED"}, {"CASH", "APPROVED"}}
	wantAmounts := []int64{18000, 18000, 10000}
	for i, p := range paid.Payments {
		if p.SourceType != wantPayments[i][0] || p.State != wantPayments[i][1] || p.Amount != wantAmounts[i] || p.PaymentMethod != p.SourceType {
			t.Errorf("bill-1 payments[%d] = %+v, want %s/%s/%d", i, p, wantPayments[i][0], wantPayments[i][1], wantAmounts[i])
		}
	}

	open := items[0]
	if open.TotalAmount != 9000 || open.PaidAmount != 0 || open.CompletedAt != "" {
		t.Errorf("bill-2 total/paid/completed = %d/%d/%q, want 9000/0/\"\" (non-cancelled menu sum)", open.TotalAmount, open.PaidAmount, open.CompletedAt)
	}
	if open.Payments == nil || len(open.Payments) != 0 {
		t.Errorf("bill-2 payments = %#v, want an empty non-nil slice", open.Payments)
	}

	cancelled := items[2]
	if cancelled.Status != "CANCELLED" || cancelled.CancelledAt != "2026-01-09T10:00:00Z" || cancelled.PaidAmount != 0 {
		t.Errorf("bill-3 = %+v, want CANCELLED with nothing paid", cancelled)
	}
}

func TestRepository_ListPOSBillsPage_Filters(t *testing.T) {
	repo := resetDB(t)
	seedAdminBillFixture(t, context.Background())

	from := time.Date(2026, 1, 10, 0, 0, 0, 0, kst)
	to := time.Date(2026, 1, 11, 0, 0, 0, 0, kst)
	cases := []struct {
		name   string
		filter POSBillFilter
		want   []string
	}{
		{"status", POSBillFilter{Status: "PAID"}, []string{"bill-1"}},
		{"approved cash only", POSBillFilter{SourceType: "CASH"}, []string{"bill-1"}},
		{"approved card", POSBillFilter{SourceType: "CARD"}, []string{"bill-1"}},
		{"no approved transfer", POSBillFilter{SourceType: "ACCOUNT_TRANSFER"}, []string{}},
		{"table search", POSBillFilter{Search: "t-03"}, []string{"bill-1", "bill-3"}},
		{"search is literal", POSBillFilter{Search: "%"}, []string{}},
		{"opened_at range", POSBillFilter{From: &from, To: &to}, []string{"bill-1"}},
		{"from only", POSBillFilter{From: &from}, []string{"bill-2", "bill-1"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, total := billIDs(t, repo, tc.filter)
			if !reflect.DeepEqual(got, tc.want) || total != len(tc.want) {
				t.Fatalf("ids/total = %v/%d, want %v/%d", got, total, tc.want, len(tc.want))
			}
		})
	}
}

func TestRepository_ListPOSBillsPage_Paginates(t *testing.T) {
	repo := resetDB(t)
	seedAdminBillFixture(t, context.Background())

	got, total := billIDs(t, repo, POSBillFilter{Page: 2, PageSize: 1})
	if !reflect.DeepEqual(got, []string{"bill-1"}) || total != 3 {
		t.Fatalf("page 2 ids/total = %v/%d, want [bill-1]/3", got, total)
	}
}

func TestRepository_GetPOSBillForAdmin_ReturnsPaymentsAndMenuRows(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	seedAdminBillFixture(t, ctx)

	bill, err := repo.GetPOSBillForAdmin(ctx, "bill-1")
	if err != nil {
		t.Fatalf("GetPOSBillForAdmin() error = %v", err)
	}
	if bill.ID != "bill-1" || bill.POSOrderID != "pos-bill-1" || bill.Status != "PAID" || bill.TableNumber != "T-03" {
		t.Errorf("bill identity = %+v", bill)
	}
	if bill.TotalAmount != 28000 || bill.PaidAmount != 28000 {
		t.Errorf("total/paid = %d/%d, want 28000/28000", bill.TotalAmount, bill.PaidAmount)
	}
	if bill.DiscountAmount == nil || *bill.DiscountAmount != 5000 {
		t.Errorf("DiscountAmount = %v, want 5000", bill.DiscountAmount)
	}
	if bill.PaymentsSyncedAt != "2026-01-10T11:00:00Z" {
		t.Errorf("PaymentsSyncedAt = %q", bill.PaymentsSyncedAt)
	}

	if len(bill.Payments) != 3 {
		t.Fatalf("Payments = %+v, want 3", bill.Payments)
	}
	void := bill.Payments[0]
	if void.ID != "pay-1-void" || void.State != "CANCELLED" || void.CardBrand != "BC" || void.ApprovedNo != "A0" ||
		void.ApprovedAt != "2026-01-10T12:40:00Z" || void.CancelledAt != "2026-01-10T12:45:00Z" {
		t.Errorf("Payments[0] = %+v", void)
	}
	card := bill.Payments[1]
	if card.ID != "pay-1-card" || card.State != "APPROVED" || card.SourceType != "CARD" || card.Amount != 18000 ||
		card.TaxAmount != 1636 || card.SupplyAmount != 16364 || card.ApprovedNo != "A1" || card.CancelledAt != "" {
		t.Errorf("Payments[1] = %+v", card)
	}
	if bill.Payments[2].ID != "pay-1-cash" {
		t.Errorf("Payments[2] = %+v, want pay-1-cash", bill.Payments[2])
	}

	if len(bill.MenuItems) != 4 {
		t.Fatalf("MenuItems = %+v, want 4", bill.MenuItems)
	}
	names := []string{}
	for _, item := range bill.MenuItems {
		names = append(names, item.MenuItemName)
	}
	if !reflect.DeepEqual(names, []string{"Beer", "Pizza", "Fries", "Soda"}) {
		t.Errorf("menu names = %v, want creation order", names)
	}
	fries := bill.MenuItems[2]
	if fries.OrderID != "bill-1-fries" || fries.Status != "CANCELLED" || fries.Amount != 5000 ||
		fries.POSOrderID != "pos-bill-1" || fries.TableNumber != "T-03" || fries.CreatedAt != "2026-01-10T11:02:00Z" {
		t.Errorf("MenuItems[2] = %+v", fries)
	}
}

func TestRepository_GetPOSBillForAdmin_OpenBillHasEmptyListsAndNullDiscount(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	seedAdminBillFixture(t, ctx)

	bill, err := repo.GetPOSBillForAdmin(ctx, "bill-2")
	if err != nil {
		t.Fatalf("GetPOSBillForAdmin() error = %v", err)
	}
	if bill.TotalAmount != 9000 || bill.PaidAmount != 0 || bill.DiscountAmount != nil || bill.PaymentsSyncedAt != "" {
		t.Errorf("bill-2 = %+v", bill)
	}
	if bill.Payments == nil || len(bill.Payments) != 0 || len(bill.MenuItems) != 2 {
		t.Errorf("bill-2 payments/menu = %#v/%d", bill.Payments, len(bill.MenuItems))
	}
}

func TestRepository_GetPOSBillForAdmin_UnknownIDIsNotFound(t *testing.T) {
	repo := resetDB(t)

	if _, err := repo.GetPOSBillForAdmin(context.Background(), "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetPOSBillForAdmin() error = %v, want ErrNotFound", err)
	}
}
