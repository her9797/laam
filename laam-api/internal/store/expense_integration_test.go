package store

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/her9797/laam/laam-api/internal/lamdata"
	"github.com/jackc/pgx/v5/pgxpool"
)

// resetExpenseDB clears the expense/inventory tables on top of resetDB and
// keeps only the seeded default categories, restoring their seeded names.
func resetExpenseDB(t *testing.T) *Repository {
	t.Helper()
	repo := resetDB(t)
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `TRUNCATE expense_receipt_lines, expense_receipts, inventory_adjustments, inventory_items RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("truncate expense tables: %v", err)
	}
	if _, err := testPool.Exec(ctx, `DELETE FROM expense_categories`); err != nil {
		t.Fatalf("delete categories: %v", err)
	}
	if err := repo.EnsureSchema(ctx); err != nil {
		t.Fatalf("ensure schema: %v", err)
	}
	return repo
}

func intPtr(v int) *int { return &v }

func mustCreateItem(t *testing.T, repo *Repository, name string, categoryID string, quantity int, minQuantity int) lamdata.InventoryItem {
	t.Helper()
	item, err := repo.CreateInventoryItem(context.Background(), CreateInventoryItemInput{
		Name: name, CategoryID: categoryID, Unit: "병", Quantity: quantity, MinQuantity: minQuantity,
	})
	if err != nil {
		t.Fatalf("create item %q: %v", name, err)
	}
	return item
}

func mustGetItem(t *testing.T, repo *Repository, id string) lamdata.InventoryItem {
	t.Helper()
	item, err := repo.GetInventoryItem(context.Background(), id)
	if err != nil {
		t.Fatalf("get item %s: %v", id, err)
	}
	return item
}

func itemLine(itemID string, quantity int, amount int64) ExpenseReceiptLineInput {
	return ExpenseReceiptLineInput{ItemID: itemID, Quantity: intPtr(quantity), Amount: amount}
}

func otherLine(categoryID string, description string, amount int64) ExpenseReceiptLineInput {
	return ExpenseReceiptLineInput{CategoryID: categoryID, Description: description, Amount: amount}
}

func receiptInput(date string, lines ...ExpenseReceiptLineInput) ExpenseReceiptInput {
	return ExpenseReceiptInput{Date: date, Vendor: "마트", PaymentMethod: "card", Memo: "", Lines: lines}
}

func TestEnsureSchema_ExpenseTablesAndDefaultCategoriesAreIdempotent(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()

	// An operator rename must survive a later EnsureSchema (ON CONFLICT DO NOTHING).
	if _, err := testPool.Exec(ctx, `UPDATE expense_categories SET name = '주류' WHERE id = 'liquor'`); err != nil {
		t.Fatalf("rename: %v", err)
	}
	for range 2 {
		if err := repo.EnsureSchema(ctx); err != nil {
			t.Fatalf("EnsureSchema rerun: %v", err)
		}
	}

	categories, err := repo.ListExpenseCategories(ctx)
	if err != nil {
		t.Fatalf("ListExpenseCategories: %v", err)
	}
	wantIDs := []string{"liquor", "glass", "garnish", "beverage", "supplies", "other"}
	if len(categories) != len(wantIDs) {
		t.Fatalf("categories = %+v, want %d defaults", categories, len(wantIDs))
	}
	for i, id := range wantIDs {
		if categories[i].ID != id || !categories[i].IsDefault {
			t.Errorf("categories[%d] = %+v, want default %q", i, categories[i], id)
		}
	}
	if categories[0].Name != "주류" {
		t.Errorf("liquor name = %q, want operator rename to survive", categories[0].Name)
	}

	for _, index := range []string{
		"idx_expense_receipts_date",
		"idx_expense_receipt_lines_receipt_id",
		"idx_expense_receipt_lines_item_id",
		"idx_inventory_adjustments_item_created_at",
	} {
		var exists bool
		if err := testPool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname = $1)`, index).Scan(&exists); err != nil || !exists {
			t.Errorf("index %s missing (err=%v)", index, err)
		}
	}
}

func TestExpenseCategories_CreateAndRename(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()

	created, err := repo.CreateExpenseCategory(ctx, "  청소 용품 ")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.Name != "청소 용품" || created.IsDefault || created.SortOrder <= 6 {
		t.Fatalf("created = %+v", created)
	}
	if _, err := repo.CreateExpenseCategory(ctx, " "); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("blank name err = %v, want ErrInvalidInput", err)
	}

	renamed, err := repo.UpdateExpenseCategory(ctx, "glass", "유리잔")
	if err != nil || renamed.Name != "유리잔" || !renamed.IsDefault {
		t.Fatalf("rename default = %+v, %v", renamed, err)
	}
	if _, err := repo.UpdateExpenseCategory(ctx, "missing", "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing err = %v, want ErrNotFound", err)
	}
}

func TestInventoryItems_CreateValidationAndDuplicateName(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()

	item := mustCreateItem(t, repo, "Jameson", "liquor", 3, 5)
	if !item.NeedsReorder || item.NeedsCheck || item.LastUnitPrice != nil || item.UpdatedAt == "" {
		t.Fatalf("item flags = %+v", item)
	}

	if _, err := repo.CreateInventoryItem(ctx, CreateInventoryItemInput{Name: " jame son ", CategoryID: "liquor", Unit: "병"}); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("duplicate err = %v, want ErrAlreadyExists", err)
	}

	invalid := []CreateInventoryItemInput{
		{Name: "", CategoryID: "liquor"},
		{Name: "A", CategoryID: "missing"},
		{Name: "B", CategoryID: "liquor", Quantity: -1},
		{Name: "C", CategoryID: "liquor", MinQuantity: -1},
	}
	for _, input := range invalid {
		if _, err := repo.CreateInventoryItem(ctx, input); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("input %+v err = %v, want ErrInvalidInput", input, err)
		}
	}

	archived := true
	if _, err := repo.UpdateInventoryItem(ctx, item.ID, UpdateInventoryItemInput{IsArchived: &archived}); err != nil {
		t.Fatalf("archive: %v", err)
	}
	// Archived items no longer reserve their name.
	mustCreateItem(t, repo, "JAMESON", "liquor", 0, 0)

	unarchived := false
	if _, err := repo.UpdateInventoryItem(ctx, item.ID, UpdateInventoryItemInput{IsArchived: &unarchived}); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("unarchive into duplicate err = %v, want ErrAlreadyExists", err)
	}
}

func TestInventoryItems_ListOrderAndArchiveFilter(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()

	mustCreateItem(t, repo, "Lime", "garnish", 10, 1)
	mustCreateItem(t, repo, "Tonic", "beverage", 0, 3)
	mustCreateItem(t, repo, "Bourbon", "liquor", 5, 1)
	mustCreateItem(t, repo, "Absolut", "liquor", 5, 1)
	old := mustCreateItem(t, repo, "Old", "liquor", 0, 9)
	archived := true
	if _, err := repo.UpdateInventoryItem(ctx, old.ID, UpdateInventoryItemInput{IsArchived: &archived}); err != nil {
		t.Fatalf("archive: %v", err)
	}

	items, err := repo.ListInventoryItems(ctx, false)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var names []string
	for _, item := range items {
		names = append(names, item.Name)
	}
	want := []string{"Tonic", "Absolut", "Bourbon", "Lime"}
	if len(names) != len(want) {
		t.Fatalf("names = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("names = %v, want %v", names, want)
		}
	}

	all, err := repo.ListInventoryItems(ctx, true)
	if err != nil || len(all) != 5 {
		t.Fatalf("includeArchived len = %d, err = %v", len(all), err)
	}
	for _, item := range all {
		if item.ID == old.ID && (item.NeedsReorder || !item.IsArchived) {
			t.Fatalf("archived item = %+v, want no reorder flag", item)
		}
	}
}

func TestAdjustInventoryItem_ManualDeltaSetAndNegativeBlocked(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()
	item := mustCreateItem(t, repo, "Gin", "liquor", 2, 0)

	updated, err := repo.AdjustInventoryItem(ctx, item.ID, AdjustInventoryItemInput{Delta: intPtr(-2)})
	if err != nil || updated.Quantity != 0 {
		t.Fatalf("delta -2 = %+v, %v", updated, err)
	}
	if _, err := repo.AdjustInventoryItem(ctx, item.ID, AdjustInventoryItemInput{Delta: intPtr(-1)}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("below zero err = %v, want ErrInvalidInput", err)
	}
	if _, err := repo.AdjustInventoryItem(ctx, item.ID, AdjustInventoryItemInput{Set: intPtr(-1)}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("set negative err = %v, want ErrInvalidInput", err)
	}
	updated, err = repo.AdjustInventoryItem(ctx, item.ID, AdjustInventoryItemInput{Set: intPtr(7)})
	if err != nil || updated.Quantity != 7 {
		t.Fatalf("set 7 = %+v, %v", updated, err)
	}
	// No-op adjustments leave no history.
	if _, err := repo.AdjustInventoryItem(ctx, item.ID, AdjustInventoryItemInput{Set: intPtr(7)}); err != nil {
		t.Fatalf("set same: %v", err)
	}
	if _, err := repo.AdjustInventoryItem(ctx, item.ID, AdjustInventoryItemInput{Delta: intPtr(0)}); err != nil {
		t.Fatalf("delta 0: %v", err)
	}
	for _, input := range []AdjustInventoryItemInput{{}, {Delta: intPtr(1), Set: intPtr(1)}} {
		if _, err := repo.AdjustInventoryItem(ctx, item.ID, input); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("input %+v err = %v, want ErrInvalidInput", input, err)
		}
	}
	if _, err := repo.AdjustInventoryItem(ctx, "missing", AdjustInventoryItemInput{Delta: intPtr(1)}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing err = %v, want ErrNotFound", err)
	}

	history, err := repo.ListInventoryAdjustments(ctx, item.ID, 50)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("history = %+v, want 2 entries", history)
	}
	if history[0].Delta != 7 || history[0].QuantityAfter != 7 || history[0].Reason != "manual" || history[0].ReceiptID != nil {
		t.Errorf("latest = %+v", history[0])
	}
	if history[1].Delta != -2 || history[1].QuantityAfter != 0 {
		t.Errorf("first = %+v", history[1])
	}
	if _, err := repo.ListInventoryAdjustments(ctx, "missing", 50); !errors.Is(err, ErrNotFound) {
		t.Fatalf("history missing err = %v, want ErrNotFound", err)
	}
}

func TestAdjustInventoryItem_ConcurrentDeltasKeepTotal(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()
	item := mustCreateItem(t, repo, "Soda", "beverage", 100, 0)

	const workers = 40
	var wg sync.WaitGroup
	errs := make(chan error, workers*2)
	for i := range workers {
		wg.Add(1)
		go func(delta int) {
			defer wg.Done()
			if _, err := repo.AdjustInventoryItem(ctx, item.ID, AdjustInventoryItemInput{Delta: intPtr(delta)}); err != nil {
				errs <- err
			}
		}(map[bool]int{true: 3, false: -2}[i%2 == 0])
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent adjust: %v", err)
	}

	want := 100 + (workers/2)*3 - (workers/2)*2
	if got := mustGetItem(t, repo, item.ID).Quantity; got != want {
		t.Fatalf("quantity = %d, want %d", got, want)
	}

	history, err := repo.ListInventoryAdjustments(ctx, item.ID, 200)
	if err != nil || len(history) != workers {
		t.Fatalf("history len = %d, err = %v", len(history), err)
	}
	sum := 0
	for _, entry := range history {
		sum += entry.Delta
	}
	if sum != want-100 {
		t.Fatalf("history delta sum = %d, want %d", sum, want-100)
	}
}

func TestExpenseReceipt_CreateUpdateDeleteAppliesInventory(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()
	gin := mustCreateItem(t, repo, "Gin", "liquor", 1, 0)
	lime := mustCreateItem(t, repo, "Lime", "garnish", 0, 0)

	receipt, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-09-10",
		itemLine(gin.ID, 3, 90000),
		itemLine(lime.ID, 10, 5000),
		otherLine("supplies", "빨대", 3000),
	))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if receipt.Total != 98000 || len(receipt.Lines) != 3 || receipt.HasImage || receipt.Date != "2026-09-10" {
		t.Fatalf("receipt = %+v", receipt)
	}
	first := receipt.Lines[0]
	if first.ItemID == nil || *first.ItemID != gin.ID || first.ItemName != "Gin" || first.CategoryID != "liquor" || first.Quantity == nil || *first.Quantity != 3 {
		t.Fatalf("item line = %+v", first)
	}
	other := receipt.Lines[2]
	if other.ItemID != nil || other.ItemName != "빨대" || other.Description != "빨대" || other.Quantity != nil || other.CategoryID != "supplies" {
		t.Fatalf("other line = %+v", other)
	}

	ginAfter := mustGetItem(t, repo, gin.ID)
	if ginAfter.Quantity != 4 || ginAfter.LastUnitPrice == nil || *ginAfter.LastUnitPrice != 30000 {
		t.Fatalf("gin after create = %+v", ginAfter)
	}
	history, _ := repo.ListInventoryAdjustments(ctx, gin.ID, 50)
	if len(history) != 1 || history[0].Reason != "purchase" || history[0].Delta != 3 || history[0].QuantityAfter != 4 || history[0].ReceiptID == nil || *history[0].ReceiptID != receipt.ID {
		t.Fatalf("gin history = %+v", history)
	}

	// Stock is consumed, then the receipt is corrected downward: the result
	// may go negative and is flagged instead of refused.
	if _, err := repo.AdjustInventoryItem(ctx, gin.ID, AdjustInventoryItemInput{Set: intPtr(0)}); err != nil {
		t.Fatalf("consume: %v", err)
	}
	updated, err := repo.UpdateExpenseReceipt(ctx, receipt.ID, receiptInput("2026-09-11",
		itemLine(gin.ID, 1, 30000),
		itemLine(gin.ID, 1, 31000),
		otherLine("other", "봉투", 500),
	))
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Total != 61500 || len(updated.Lines) != 3 || updated.Date != "2026-09-11" {
		t.Fatalf("updated = %+v", updated)
	}
	ginAfter = mustGetItem(t, repo, gin.ID)
	if ginAfter.Quantity != -1 || !ginAfter.NeedsCheck {
		t.Fatalf("gin after edit = %+v, want -1 and needsCheck", ginAfter)
	}
	limeAfter := mustGetItem(t, repo, lime.ID)
	if limeAfter.Quantity != 0 {
		t.Fatalf("lime after edit = %+v, want 0", limeAfter)
	}
	history, _ = repo.ListInventoryAdjustments(ctx, gin.ID, 50)
	if history[0].Reason != "receipt_edit" || history[0].Delta != -1 || history[0].QuantityAfter != -1 {
		t.Fatalf("gin edit history = %+v", history[0])
	}
	limeHistory, _ := repo.ListInventoryAdjustments(ctx, lime.ID, 50)
	if len(limeHistory) != 2 || limeHistory[0].Reason != "receipt_edit" || limeHistory[0].Delta != -10 {
		t.Fatalf("lime history = %+v", limeHistory)
	}

	// An unchanged item quantity leaves no receipt_edit entry.
	if _, err := repo.UpdateExpenseReceipt(ctx, receipt.ID, receiptInput("2026-09-11", itemLine(gin.ID, 2, 60000))); err != nil {
		t.Fatalf("update same qty: %v", err)
	}
	if again, _ := repo.ListInventoryAdjustments(ctx, gin.ID, 50); len(again) != len(history) {
		t.Fatalf("history grew on unchanged quantity: %+v", again)
	}

	imagePath, err := repo.DeleteExpenseReceipt(ctx, receipt.ID)
	if err != nil || imagePath != "" {
		t.Fatalf("delete = %q, %v", imagePath, err)
	}
	ginAfter = mustGetItem(t, repo, gin.ID)
	if ginAfter.Quantity != -3 {
		t.Fatalf("gin after delete = %d, want -3", ginAfter.Quantity)
	}
	history, _ = repo.ListInventoryAdjustments(ctx, gin.ID, 1)
	if len(history) != 1 || history[0].Reason != "receipt_delete" || history[0].Delta != -2 {
		t.Fatalf("delete history = %+v", history)
	}
	if _, err := repo.GetExpenseReceipt(ctx, receipt.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get deleted err = %v, want ErrNotFound", err)
	}
	if _, err := repo.DeleteExpenseReceipt(ctx, receipt.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete again err = %v, want ErrNotFound", err)
	}
}

func TestExpenseReceipt_ValidationErrors(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()
	gin := mustCreateItem(t, repo, "Gin", "liquor", 0, 0)
	old := mustCreateItem(t, repo, "Old", "liquor", 0, 0)
	archived := true
	if _, err := repo.UpdateInventoryItem(ctx, old.ID, UpdateInventoryItemInput{IsArchived: &archived}); err != nil {
		t.Fatalf("archive: %v", err)
	}

	long := func(n int) string {
		s := make([]rune, n)
		for i := range s {
			s[i] = '가'
		}
		return string(s)
	}
	tooMany := make([]ExpenseReceiptLineInput, 101)
	for i := range tooMany {
		tooMany[i] = otherLine("other", "x", 1)
	}

	cases := map[string]ExpenseReceiptInput{
		"no lines":           receiptInput("2026-09-01"),
		"too many lines":     receiptInput("2026-09-01", tooMany...),
		"bad date":           receiptInput("2026-13-01", otherLine("other", "x", 1)),
		"negative amount":    receiptInput("2026-09-01", otherLine("other", "x", -1)),
		"zero quantity":      receiptInput("2026-09-01", itemLine(gin.ID, 0, 1)),
		"missing quantity":   receiptInput("2026-09-01", ExpenseReceiptLineInput{ItemID: gin.ID, Amount: 1}),
		"missing desc":       receiptInput("2026-09-01", otherLine("other", " ", 1)),
		"unknown category":   receiptInput("2026-09-01", otherLine("nope", "x", 1)),
		"unknown item":       receiptInput("2026-09-01", itemLine("nope", 1, 1)),
		"archived item":      receiptInput("2026-09-01", itemLine(old.ID, 1, 1)),
		"bad payment method": {Date: "2026-09-01", PaymentMethod: "coupon", Lines: []ExpenseReceiptLineInput{otherLine("other", "x", 1)}},
		"vendor too long":    {Date: "2026-09-01", PaymentMethod: "cash", Vendor: long(101), Lines: []ExpenseReceiptLineInput{otherLine("other", "x", 1)}},
		"memo too long":      {Date: "2026-09-01", PaymentMethod: "cash", Memo: long(501), Lines: []ExpenseReceiptLineInput{otherLine("other", "x", 1)}},
	}
	for name, input := range cases {
		if _, err := repo.CreateExpenseReceipt(ctx, input); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("%s: err = %v, want ErrInvalidInput", name, err)
		}
	}
	if got := mustGetItem(t, repo, gin.ID).Quantity; got != 0 {
		t.Fatalf("gin quantity = %d after rejected receipts, want 0", got)
	}

	okInput := ExpenseReceiptInput{Date: "2026-09-01", PaymentMethod: "transfer", Vendor: long(100), Memo: long(500), Lines: []ExpenseReceiptLineInput{otherLine("other", "x", 0)}}
	if _, err := repo.CreateExpenseReceipt(ctx, okInput); err != nil {
		t.Fatalf("boundary lengths rejected: %v", err)
	}
	if _, err := repo.UpdateExpenseReceipt(ctx, "missing", okInput); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update missing err = %v, want ErrNotFound", err)
	}
}

func TestExpenseReceipt_EditKeepsExistingArchivedItemLine(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()
	item := mustCreateItem(t, repo, "Old", "liquor", 0, 0)
	receipt, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-09-01", itemLine(item.ID, 2, 1000)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	archived := true
	if _, err := repo.UpdateInventoryItem(ctx, item.ID, UpdateInventoryItemInput{IsArchived: &archived}); err != nil {
		t.Fatalf("archive: %v", err)
	}
	input := receiptInput("2026-09-01", itemLine(item.ID, 2, 1000))
	input.Memo = "메모만 수정"
	if _, err := repo.UpdateExpenseReceipt(ctx, receipt.ID, input); err != nil {
		t.Fatalf("memo-only edit with archived item line: %v", err)
	}
}

func TestExpenseReceipts_MonthBoundaryAndCategoryFilter(t *testing.T) {
	resetExpenseDB(t)
	ctx := context.Background()

	// Every connection runs under a session time zone far from Seoul, so a
	// date stored or compared as a timestamp would shift across the month
	// boundary.
	poolConfig, err := pgxpool.ParseConfig(testPool.Config().ConnString())
	if err != nil {
		t.Fatalf("parse pool config: %v", err)
	}
	poolConfig.ConnConfig.RuntimeParams["timezone"] = "America/Los_Angeles"
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	defer pool.Close()
	repo := New(pool)
	gin := mustCreateItem(t, repo, "Gin", "liquor", 0, 0)

	aug, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-08-31", otherLine("other", "a", 100)))
	if err != nil {
		t.Fatalf("create aug: %v", err)
	}
	sepEnd, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-09-30", itemLine(gin.ID, 1, 200)))
	if err != nil {
		t.Fatalf("create sep: %v", err)
	}
	sepStart, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-09-01", otherLine("supplies", "b", 300)))
	if err != nil {
		t.Fatalf("create sep start: %v", err)
	}
	oct, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-10-01", otherLine("other", "c", 400)))
	if err != nil {
		t.Fatalf("create oct: %v", err)
	}

	ids := func(receipts []lamdata.ExpenseReceipt) []string {
		var out []string
		for _, receipt := range receipts {
			out = append(out, receipt.ID)
		}
		return out
	}
	assertIDs := func(label string, got []lamdata.ExpenseReceipt, want ...string) {
		t.Helper()
		gotIDs := ids(got)
		if len(gotIDs) != len(want) {
			t.Fatalf("%s = %v, want %v", label, gotIDs, want)
		}
		for i := range want {
			if gotIDs[i] != want[i] {
				t.Fatalf("%s = %v, want %v", label, gotIDs, want)
			}
		}
	}

	sep, err := repo.ListExpenseReceipts(ctx, "2026-09", "")
	if err != nil {
		t.Fatalf("list sep: %v", err)
	}
	assertIDs("september", sep, sepEnd.ID, sepStart.ID)
	if sep[0].Date != "2026-09-30" || len(sep[0].Lines) != 1 {
		t.Fatalf("sep[0] = %+v", sep[0])
	}

	octList, _ := repo.ListExpenseReceipts(ctx, "2026-10", "")
	assertIDs("october", octList, oct.ID)
	augList, _ := repo.ListExpenseReceipts(ctx, "2026-08", "")
	assertIDs("august", augList, aug.ID)

	liquor, _ := repo.ListExpenseReceipts(ctx, "2026-09", "liquor")
	assertIDs("september liquor", liquor, sepEnd.ID)

	for _, month := range []string{"", "2026-9", "2026-13", "202609", "2026-09-01"} {
		if _, err := repo.ListExpenseReceipts(ctx, month, ""); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("month %q err = %v, want ErrInvalidInput", month, err)
		}
	}
}

func TestExpenseSummary_AggregatesMonthAndCategories(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()
	gin := mustCreateItem(t, repo, "Gin", "liquor", 0, 0)

	mustReceipt := func(input ExpenseReceiptInput) {
		t.Helper()
		if _, err := repo.CreateExpenseReceipt(ctx, input); err != nil {
			t.Fatalf("create receipt: %v", err)
		}
	}
	mustReceipt(receiptInput("2026-08-15", otherLine("other", "a", 7000)))
	mustReceipt(receiptInput("2026-09-02", itemLine(gin.ID, 2, 50000), otherLine("supplies", "b", 12000)))
	mustReceipt(receiptInput("2026-09-30", otherLine("supplies", "c", 8000), otherLine("glass", "d", 0)))
	mustReceipt(receiptInput("2026-10-01", otherLine("other", "e", 999)))

	summary, err := repo.GetExpenseSummary(ctx, "2026-09")
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if summary.Month != "2026-09" || summary.Total != 70000 || summary.PreviousMonthTotal != 7000 || summary.ReceiptCount != 2 {
		t.Fatalf("summary = %+v", summary)
	}
	want := []lamdata.ExpenseCategoryAmount{
		{CategoryID: "liquor", Name: "술", Amount: 50000},
		{CategoryID: "supplies", Name: "가게 자재", Amount: 20000},
	}
	if len(summary.ByCategory) != len(want) {
		t.Fatalf("byCategory = %+v, want %+v", summary.ByCategory, want)
	}
	for i := range want {
		if summary.ByCategory[i] != want[i] {
			t.Fatalf("byCategory = %+v, want %+v", summary.ByCategory, want)
		}
	}

	empty, err := repo.GetExpenseSummary(ctx, "2027-01")
	if err != nil || empty.Total != 0 || empty.ReceiptCount != 0 || empty.ByCategory == nil || len(empty.ByCategory) != 0 {
		t.Fatalf("empty summary = %+v, %v", empty, err)
	}
	if _, err := repo.GetExpenseSummary(ctx, "bad"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("bad month err = %v", err)
	}
}

func TestInventorySummary_CountsActiveFlags(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()
	mustCreateItem(t, repo, "Low", "liquor", 1, 2)
	mustCreateItem(t, repo, "Fine", "liquor", 5, 2)
	negative := mustCreateItem(t, repo, "Negative", "liquor", 0, 0)
	archivedLow := mustCreateItem(t, repo, "ArchivedLow", "liquor", 0, 3)

	receipt, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-09-01", itemLine(negative.ID, 3, 100)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := repo.AdjustInventoryItem(ctx, negative.ID, AdjustInventoryItemInput{Set: intPtr(1)}); err != nil {
		t.Fatalf("consume: %v", err)
	}
	if _, err := repo.UpdateExpenseReceipt(ctx, receipt.ID, receiptInput("2026-09-01", otherLine("other", "x", 100))); err != nil {
		t.Fatalf("update: %v", err)
	}
	archived := true
	if _, err := repo.UpdateInventoryItem(ctx, archivedLow.ID, UpdateInventoryItemInput{IsArchived: &archived}); err != nil {
		t.Fatalf("archive: %v", err)
	}

	summary, err := repo.GetInventorySummary(ctx)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	// Negative (-2 < 0 min) also counts toward reorder.
	if summary.ReorderCount != 2 || summary.NeedsCheckCount != 1 {
		t.Fatalf("summary = %+v, want reorder 2 needsCheck 1", summary)
	}
}

func TestExpenseReceiptImagePath_SetReplaceClear(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()
	receipt, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-09-01", otherLine("other", "x", 1)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	old, err := repo.SetExpenseReceiptImagePath(ctx, receipt.ID, "receipts/a.png")
	if err != nil || old != "" {
		t.Fatalf("first set = %q, %v", old, err)
	}
	old, err = repo.SetExpenseReceiptImagePath(ctx, receipt.ID, "receipts/b.png")
	if err != nil || old != "receipts/a.png" {
		t.Fatalf("replace = %q, %v", old, err)
	}
	got, err := repo.GetExpenseReceipt(ctx, receipt.ID)
	if err != nil || !got.HasImage {
		t.Fatalf("hasImage = %+v, %v", got, err)
	}
	if path, err := repo.GetExpenseReceiptImagePath(ctx, receipt.ID); err != nil || path != "receipts/b.png" {
		t.Fatalf("path = %q, %v", path, err)
	}
	// A stale clear (the image was replaced meanwhile) must not drop the new path.
	if err := repo.ClearExpenseReceiptImagePath(ctx, receipt.ID, "receipts/a.png"); err != nil {
		t.Fatalf("stale clear: %v", err)
	}
	if path, _ := repo.GetExpenseReceiptImagePath(ctx, receipt.ID); path != "receipts/b.png" {
		t.Fatalf("path after stale clear = %q", path)
	}
	if err := repo.ClearExpenseReceiptImagePath(ctx, receipt.ID, "receipts/b.png"); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if path, _ := repo.GetExpenseReceiptImagePath(ctx, receipt.ID); path != "" {
		t.Fatalf("path after clear = %q", path)
	}

	if _, err := repo.SetExpenseReceiptImagePath(ctx, receipt.ID, "receipts/c.png"); err != nil {
		t.Fatalf("set c: %v", err)
	}
	imagePath, err := repo.DeleteExpenseReceipt(ctx, receipt.ID)
	if err != nil || imagePath != "receipts/c.png" {
		t.Fatalf("delete returned %q, %v", imagePath, err)
	}
	if _, err := repo.GetExpenseReceiptImagePath(ctx, receipt.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("path of deleted err = %v", err)
	}
}

func TestInventoryItem_LastPurchaseFollowsMostRecentReceiptLine(t *testing.T) {
	repo := resetExpenseDB(t)
	ctx := context.Background()
	gin := mustCreateItem(t, repo, "Gin", "liquor", 0, 0)
	if gin.LastPurchasedAt != nil || gin.LastUnitPrice != nil {
		t.Fatalf("new item = %+v, want no purchase", gin)
	}

	assertLast := func(label string, wantAt string, wantPrice int64) {
		t.Helper()
		item := mustGetItem(t, repo, gin.ID)
		if wantAt == "" {
			if item.LastPurchasedAt != nil || item.LastUnitPrice != nil {
				t.Fatalf("%s: lastPurchasedAt=%v lastUnitPrice=%v, want nil", label, item.LastPurchasedAt, item.LastUnitPrice)
			}
			return
		}
		if item.LastPurchasedAt == nil || *item.LastPurchasedAt != wantAt || item.LastUnitPrice == nil || *item.LastUnitPrice != wantPrice {
			t.Fatalf("%s: lastPurchasedAt=%v lastUnitPrice=%v, want %s / %d", label, item.LastPurchasedAt, item.LastUnitPrice, wantAt, wantPrice)
		}
		listed, err := repo.ListInventoryItems(ctx, false)
		if err != nil || len(listed) != 1 || listed[0].LastPurchasedAt == nil || *listed[0].LastPurchasedAt != wantAt {
			t.Fatalf("%s: listed = %+v, %v", label, listed, err)
		}
	}

	newer, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-09-20", itemLine(gin.ID, 2, 50000)))
	if err != nil {
		t.Fatalf("create newer: %v", err)
	}
	assertLast("after newer", newer.CreatedAt, 25000)

	// Entered later but dated earlier: the receipt date wins.
	older, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-09-10", itemLine(gin.ID, 3, 60000)))
	if err != nil {
		t.Fatalf("create older: %v", err)
	}
	assertLast("after older-dated receipt", newer.CreatedAt, 25000)

	// Editing the item line off the newer receipt falls back to the older one.
	if _, err := repo.UpdateExpenseReceipt(ctx, newer.ID, receiptInput("2026-09-20", otherLine("other", "x", 1))); err != nil {
		t.Fatalf("update newer: %v", err)
	}
	assertLast("after edit", older.CreatedAt, 20000)

	// Same date: the later-created receipt wins.
	sameDay, err := repo.CreateExpenseReceipt(ctx, receiptInput("2026-09-10", itemLine(gin.ID, 4, 10000)))
	if err != nil {
		t.Fatalf("create same day: %v", err)
	}
	assertLast("after same-day receipt", sameDay.CreatedAt, 2500)

	if _, err := repo.DeleteExpenseReceipt(ctx, sameDay.ID); err != nil {
		t.Fatalf("delete same day: %v", err)
	}
	assertLast("after delete same day", older.CreatedAt, 20000)
	if _, err := repo.DeleteExpenseReceipt(ctx, older.ID); err != nil {
		t.Fatalf("delete older: %v", err)
	}
	assertLast("after deleting all", "", 0)
}
