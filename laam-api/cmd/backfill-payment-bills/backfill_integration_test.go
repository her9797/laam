package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
)

const (
	fakeAccessKey  = "fake-access-key-DO-NOT-PRINT"
	fakeSecretKey  = "fake-secret-key-DO-NOT-PRINT"
	fakeMerchantID = "merchant-1"
	fakeCardNo     = "9876-54**-****-4321"
)

// fakeTossPlace serves GET order and GET payments-by-order-id for the
// orders it knows; any other order ID gets a TossPlace-style failure.
type fakeTossPlace struct {
	mu       sync.Mutex
	orders   map[string]string // order ID -> Order JSON
	payments map[string]string // order ID -> Payment[] JSON
	calls    int
}

func newFakeTossPlace(t *testing.T) (*fakeTossPlace, *httptest.Server) {
	t.Helper()
	fake := &fakeTossPlace{orders: map[string]string{}, payments: map[string]string{}}
	prefix := "/api-public/openapi/v1/merchants/" + fakeMerchantID
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		fake.calls++
		if r.Method != http.MethodGet || r.Header.Get("x-access-key") != fakeAccessKey || r.Header.Get("x-secret-key") != fakeSecretKey {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		var body string
		var ok bool
		switch {
		case r.URL.Path == prefix+"/payment/payments/by-order-id":
			body, ok = fake.payments[r.URL.Query().Get("orderId")]
		case strings.HasPrefix(r.URL.Path, prefix+"/order/orders/"):
			body, ok = fake.orders[strings.TrimPrefix(r.URL.Path, prefix+"/order/orders/")]
		}
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"resultType":"FAILURE","error":{"errorCode":"ORDER_NOT_FOUND","reason":"not found"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"resultType":"SUCCESS","success":` + body + `}`))
	}))
	t.Cleanup(server.Close)
	return fake, server
}

func (f *fakeTossPlace) setOrder(id string, state string, completedAt string, total int64, discount int64, payments string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.orders[id] = `{"id":"` + id + `","orderState":"` + state + `","completedAt":"` + completedAt +
		`","chargePrice":{"totalAmount":` + itoa(total) + `,"discountAmount":` + itoa(discount) + `},"lineItems":[]}`
	f.payments[id] = payments
}

func itoa(v int64) string {
	return strconv.FormatInt(v, 10)
}

func paymentJSON(id string, state string, sourceType string, amount int64, approvedAt string, cancelledAt string) string {
	return `{"id":"` + id + `","state":"` + state + `","sourceType":"` + sourceType + `","paymentMethod":"m",` +
		`"amount":` + itoa(amount) + `,"taxAmount":0,"supplyAmount":0,"taxExemptAmount":0,"approvedNo":"AP-1",` +
		`"approvedAt":"` + approvedAt + `","cancelledAt":"` + cancelledAt + `",` +
		`"cardDetails":{"cardBrand":"신한","cardNo":"` + fakeCardNo + `"}}`
}

func testConfig(serverURL string) config.Config {
	return config.Config{
		DatabaseURL:         testDSN,
		TossPlaceAPIBaseURL: serverURL,
		TossPlaceAccessKey:  fakeAccessKey,
		TossPlaceSecretKey:  fakeSecretKey,
		TossPlaceMerchantID: fakeMerchantID,
		AdminAPIToken:       "admin-token-DO-NOT-PRINT",
	}
}

func seedOrder(t *testing.T, id string, posOrderID string, amount int64, status string, createdAt time.Time) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO payment_orders (id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, pos_order_id, created_at)
		VALUES ($1, '하우스 하이볼', '하이볼', 'T-03', $2, $3, 'SUCCEEDED', $4, $5)
	`, id, amount, status, posOrderID, createdAt); err != nil {
		t.Fatalf("seed payment_orders %q: %v", id, err)
	}
}

func runBackfill(t *testing.T, cfg config.Config, args ...string) (int, string) {
	t.Helper()
	var out bytes.Buffer
	code := run(context.Background(), append([]string{"--delay", "0"}, args...), cfg, &out)
	return code, out.String()
}

type dbState struct {
	Bills    int
	Payments int
	Rows     map[string]string // id -> status|bill linked
}

func snapshotDB(t *testing.T) dbState {
	t.Helper()
	ctx := context.Background()
	state := dbState{Rows: map[string]string{}}
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM pos_bills`).Scan(&state.Bills); err != nil {
		t.Fatal(err)
	}
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM pos_payments`).Scan(&state.Payments); err != nil {
		t.Fatal(err)
	}
	rows, err := testPool.Query(ctx, `SELECT id, status, bill_id IS NOT NULL, COALESCE(payment_method, ''), updated_at FROM payment_orders ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, status, method string
		var linked bool
		var updatedAt time.Time
		if err := rows.Scan(&id, &status, &linked, &method, &updatedAt); err != nil {
			t.Fatal(err)
		}
		state.Rows[id] = status + "|" + map[bool]string{true: "linked", false: "unlinked"}[linked] + "|" + method + "|" + updatedAt.String()
	}
	return state
}

func rowStatus(t *testing.T, id string) string {
	t.Helper()
	var status string
	if err := testPool.QueryRow(context.Background(), `SELECT status FROM payment_orders WHERE id = $1`, id).Scan(&status); err != nil {
		t.Fatalf("row %q: %v", id, err)
	}
	return status
}

type billRow struct {
	ID          string
	Status      string
	Total       *int64
	Discount    *int64
	CompletedAt *time.Time
	Synced      bool
}

func loadBill(t *testing.T, posOrderID string) billRow {
	t.Helper()
	var bill billRow
	if err := testPool.QueryRow(context.Background(), `
		SELECT id, status, total_amount, discount_amount, completed_at, payments_synced_at IS NOT NULL
		FROM pos_bills WHERE pos_order_id = $1
	`, posOrderID).Scan(&bill.ID, &bill.Status, &bill.Total, &bill.Discount, &bill.CompletedAt, &bill.Synced); err != nil {
		t.Fatalf("bill %q: %v", posOrderID, err)
	}
	return bill
}

// seedStuckTable reproduces the old bug: three web orders appended to one
// table's POS order, of which only the first was marked DONE when the table
// paid. pos-cancel is a POS order that was later cancelled; pos-open is
// still open at the POS.
func seedStuckTable(t *testing.T, fake *fakeTossPlace) {
	t.Helper()
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seedOrder(t, "order-1", "pos-paid", 11000, "DONE", base)
	seedOrder(t, "order-2", "pos-paid", 9000, "READY", base.Add(time.Minute))
	seedOrder(t, "order-3", "pos-paid", 7000, "ACKNOWLEDGED", base.Add(2*time.Minute))
	seedOrder(t, "order-4", "pos-cancel", 5000, "DONE", base.Add(3*time.Minute))
	seedOrder(t, "order-5", "pos-open", 6000, "READY", base.Add(4*time.Minute))

	fake.setOrder("pos-paid", "COMPLETED", "2026-09-01T13:00:00Z", 24000, 3000, `[`+
		paymentJSON("pay-card", "APPROVED", "CARD", 15000, "2026-09-01T13:00:00Z", "")+`,`+
		paymentJSON("pay-cash", "APPROVED", "CASH", 9000, "2026-09-01T13:00:05Z", "")+`]`)
	fake.setOrder("pos-cancel", "CANCELLED", "", 5000, 0, `[`+
		paymentJSON("pay-refund", "CANCELLED", "CARD", 5000, "2026-09-01T12:10:00Z", "2026-09-01T12:30:00Z")+`]`)
	fake.setOrder("pos-open", "OPENED", "", 6000, 0, `[]`)
}

func TestBackfill_DryRunWritesNothingAndReportsPlan(t *testing.T) {
	resetTables(t)
	fake, server := newFakeTossPlace(t)
	seedStuckTable(t, fake)
	before := snapshotDB(t)

	code, out := runBackfill(t, testConfig(server.URL))
	t.Logf("dry-run output:\n%s", out)

	if code != 0 {
		t.Fatalf("exit code = %d, output:\n%s", code, out)
	}
	after := snapshotDB(t)
	if after.Bills != 0 || after.Payments != 0 {
		t.Fatalf("dry-run wrote bills=%d payments=%d, want none", after.Bills, after.Payments)
	}
	for id, row := range before.Rows {
		if after.Rows[id] != row {
			t.Fatalf("dry-run changed %s: %q -> %q", id, row, after.Rows[id])
		}
	}
	for _, want := range []string{
		"DRY-RUN",
		"pos_order_id=pos-paid state=COMPLETED",
		"bills_to_create=3",
		"rows_to_done=2 amount=16000",
		"rows_to_cancelled=1 done_amount=5000",
		"CARD/APPROVED count=1 amount=15000",
		"CASH/APPROVED count=1 amount=9000",
		"CARD/CANCELLED count=1 amount=5000",
		"failures=0",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q:\n%s", want, out)
		}
	}
	assertNoSecrets(t, out)
}

func TestBackfill_DryRunConnectionRejectsWrites(t *testing.T) {
	resetTables(t)
	pool, err := openPool(context.Background(), testDSN, 0, true)
	if err != nil {
		t.Fatalf("openPool() error = %v", err)
	}
	defer pool.Close()

	if _, err := pool.Exec(context.Background(), `
		INSERT INTO pos_bills (id, pos_order_id) VALUES ('bill-x', 'pos-x')
	`); err == nil {
		t.Fatal("dry-run pool accepted a write, want a read-only transaction error")
	}
}

func TestBackfill_ApplyCreatesBillsPaymentsAndCompletesStuckRows(t *testing.T) {
	resetTables(t)
	fake, server := newFakeTossPlace(t)
	seedStuckTable(t, fake)

	code, out := runBackfill(t, testConfig(server.URL), "--apply")

	if code != 0 {
		t.Fatalf("exit code = %d, output:\n%s", code, out)
	}
	for _, id := range []string{"order-1", "order-2", "order-3"} {
		if status := rowStatus(t, id); status != "DONE" {
			t.Fatalf("%s status = %q, want DONE", id, status)
		}
	}
	paid := loadBill(t, "pos-paid")
	if paid.Status != "PAID" || paid.Total == nil || *paid.Total != 24000 || paid.Discount == nil || *paid.Discount != 3000 || !paid.Synced {
		t.Fatalf("pos-paid bill = %+v, want PAID total 24000 discount 3000 synced", paid)
	}
	if paid.CompletedAt == nil || !paid.CompletedAt.Equal(time.Date(2026, 9, 1, 13, 0, 0, 0, time.UTC)) {
		t.Fatalf("pos-paid completed_at = %v, want the order's completedAt", paid.CompletedAt)
	}
	var payments int
	var cardBrand string
	if err := testPool.QueryRow(context.Background(), `
		SELECT COUNT(*), MAX(card_brand) FROM pos_payments WHERE bill_id = $1
	`, paid.ID).Scan(&payments, &cardBrand); err != nil {
		t.Fatal(err)
	}
	if payments != 2 || cardBrand != "신한" {
		t.Fatalf("pos-paid payments = %d brand %q, want 2 신한", payments, cardBrand)
	}

	if status := rowStatus(t, "order-4"); status != "CANCELLED" {
		t.Fatalf("order-4 status = %q, want CANCELLED", status)
	}
	if bill := loadBill(t, "pos-cancel"); bill.Status != "CANCELLED" {
		t.Fatalf("pos-cancel bill = %+v, want CANCELLED", bill)
	}

	open := loadBill(t, "pos-open")
	if open.Status != "OPEN" || open.Synced {
		t.Fatalf("pos-open bill = %+v, want OPEN and not marked payment-synced", open)
	}
	if status := rowStatus(t, "order-5"); status != "READY" {
		t.Fatalf("order-5 status = %q, want READY", status)
	}
	if !strings.Contains(out, "APPLY") {
		t.Errorf("output missing APPLY mode marker:\n%s", out)
	}
	assertNoSecrets(t, out)
}

func TestBackfill_PerOrderAPIErrorIsReportedAndOthersContinue(t *testing.T) {
	resetTables(t)
	fake, server := newFakeTossPlace(t)
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	seedOrder(t, "order-missing", "pos-missing", 4000, "READY", base)
	seedOrder(t, "order-ok", "pos-ok", 8000, "READY", base.Add(time.Minute))
	fake.setOrder("pos-ok", "COMPLETED", "2026-09-01T13:00:00Z", 8000, 0,
		`[`+paymentJSON("pay-ok", "APPROVED", "CARD", 8000, "2026-09-01T13:00:00Z", "")+`]`)

	code, out := runBackfill(t, testConfig(server.URL), "--apply")

	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero when an order failed; output:\n%s", out)
	}
	if !strings.Contains(out, "failures=1") || !strings.Contains(out, "pos-missing") || !strings.Contains(out, "ORDER_NOT_FOUND") {
		t.Fatalf("output does not report the failed order:\n%s", out)
	}
	if status := rowStatus(t, "order-ok"); status != "DONE" {
		t.Fatalf("order-ok status = %q, want DONE despite the other order failing", status)
	}
	if status := rowStatus(t, "order-missing"); status != "READY" {
		t.Fatalf("order-missing status = %q, want untouched READY", status)
	}
	var bills int
	if err := testPool.QueryRow(context.Background(), `SELECT COUNT(*) FROM pos_bills WHERE pos_order_id = 'pos-missing'`).Scan(&bills); err != nil {
		t.Fatal(err)
	}
	if bills != 0 {
		t.Fatalf("pos-missing bills = %d, want none", bills)
	}
}

func TestBackfill_RerunIsIdempotent(t *testing.T) {
	resetTables(t)
	fake, server := newFakeTossPlace(t)
	seedStuckTable(t, fake)

	if code, out := runBackfill(t, testConfig(server.URL), "--apply"); code != 0 {
		t.Fatalf("first run exit code = %d, output:\n%s", code, out)
	}
	firstBill := loadBill(t, "pos-paid")
	first := snapshotDB(t)

	code, out := runBackfill(t, testConfig(server.URL), "--apply")
	if code != 0 {
		t.Fatalf("second run exit code = %d, output:\n%s", code, out)
	}
	second := snapshotDB(t)
	if second.Bills != first.Bills || second.Payments != first.Payments {
		t.Fatalf("second run changed counts: %+v -> %+v", first, second)
	}
	for id, row := range first.Rows {
		if second.Rows[id] != row {
			t.Fatalf("second run changed %s: %q -> %q", id, row, second.Rows[id])
		}
	}
	if bill := loadBill(t, "pos-paid"); bill.ID != firstBill.ID || !bill.CompletedAt.Equal(*firstBill.CompletedAt) {
		t.Fatalf("second run changed bill: %+v -> %+v", firstBill, bill)
	}
	for _, want := range []string{"bills_to_create=0", "rows_to_done=0 amount=0", "rows_to_cancelled=0 done_amount=0", "new_payments=0"} {
		if !strings.Contains(out, want) {
			t.Errorf("second run output missing %q:\n%s", want, out)
		}
	}
}

func TestBackfill_LimitProcessesOnlyTheOldestOrders(t *testing.T) {
	resetTables(t)
	fake, server := newFakeTossPlace(t)
	seedStuckTable(t, fake)

	code, out := runBackfill(t, testConfig(server.URL), "--apply", "--limit", "1")
	if code != 0 {
		t.Fatalf("exit code = %d, output:\n%s", code, out)
	}
	if state := snapshotDB(t); state.Bills != 1 {
		t.Fatalf("bills = %d, want 1 with --limit 1", state.Bills)
	}
	loadBill(t, "pos-paid")
}

func assertNoSecrets(t *testing.T, out string) {
	t.Helper()
	for _, secret := range []string{fakeAccessKey, fakeSecretKey, fakeCardNo, "admin-token-DO-NOT-PRINT", "laam:laam@", "AP-1"} {
		if strings.Contains(out, secret) {
			t.Errorf("output leaks %q:\n%s", secret, out)
		}
	}
}
