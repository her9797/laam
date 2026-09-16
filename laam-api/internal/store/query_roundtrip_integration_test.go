package store

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// roundTripRecorder records every statement a Repository sends, separating
// individually executed queries from pgx.Batch sends, so tests can pin how
// many database round trips an operation costs without depending on timing.
type roundTripRecorder struct {
	mu      sync.Mutex
	queries []string
	batches int
}

func (r *roundTripRecorder) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.queries = append(r.queries, strings.Join(strings.Fields(data.SQL), " "))
	return ctx
}

func (r *roundTripRecorder) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func (r *roundTripRecorder) TraceBatchStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceBatchStartData) context.Context {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.batches++
	return ctx
}

func (r *roundTripRecorder) TraceBatchQuery(context.Context, *pgx.Conn, pgx.TraceBatchQueryData) {}

func (r *roundTripRecorder) TraceBatchEnd(context.Context, *pgx.Conn, pgx.TraceBatchEndData) {}

// reset drops everything recorded so far (e.g. connection setup or test
// seeding) so assertions only cover the operation under test.
func (r *roundTripRecorder) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.queries = nil
	r.batches = 0
}

func (r *roundTripRecorder) snapshot() ([]string, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.queries...), r.batches
}

// newRecordingRepo opens a second pool against the shared test database with
// a roundTripRecorder attached. Callers reset the database through resetDB
// (or resetPaymentOrdersTable) first, exactly like tests using testRepo.
func newRecordingRepo(t *testing.T) (*Repository, *roundTripRecorder) {
	t.Helper()
	if testPool == nil {
		t.Skip("docker not available; skipping integration test")
	}

	config := testPool.Config().Copy()
	recorder := &roundTripRecorder{}
	config.ConnConfig.Tracer = recorder
	config.MaxConns = 1

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatalf("open recording pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping recording pool: %v", err)
	}
	recorder.reset()
	return New(pool), recorder
}

func TestRepository_ListPaymentOrdersPage_SkipTotalRunsOnlyTheListQuery(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	createPaymentOrdersForListing(t, ctx)
	repo, recorder := newRecordingRepo(t)

	full, fullTotal, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{Status: "DONE", Page: 1, PageSize: 2})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage() error = %v", err)
	}
	if fullTotal != 3 || len(full) != 2 {
		t.Fatalf("baseline total=%d items=%d, want total=3 items=2", fullTotal, len(full))
	}
	recorder.reset()

	items, _, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{Status: "DONE", Page: 1, PageSize: 2, SkipTotal: true})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage(SkipTotal) error = %v", err)
	}
	if len(items) != len(full) {
		t.Fatalf("items = %d, want %d", len(items), len(full))
	}
	for i := range items {
		if items[i].OrderID != full[i].OrderID {
			t.Errorf("items[%d] = %q, want %q", i, items[i].OrderID, full[i].OrderID)
		}
	}

	queries, _ := recorder.snapshot()
	if len(queries) != 1 || strings.Contains(queries[0], "COUNT(") {
		t.Fatalf("queries = %q, want exactly the list query", queries)
	}
}

func TestRepository_ListPaymentOrdersPage_SkipItemsRunsOnlyTheCountQuery(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	createPaymentOrdersForListing(t, ctx)
	repo, recorder := newRecordingRepo(t)

	items, total, err := repo.ListPaymentOrdersPage(ctx, PaymentOrderFilter{Status: "READY", Page: 1, PageSize: 1, SkipItems: true})
	if err != nil {
		t.Fatalf("ListPaymentOrdersPage(SkipItems) error = %v", err)
	}
	if total != 2 {
		t.Errorf("total = %d, want 2", total)
	}
	if items == nil || len(items) != 0 {
		t.Errorf("items = %#v, want an empty non-nil slice", items)
	}

	queries, _ := recorder.snapshot()
	if len(queries) != 1 || !strings.Contains(queries[0], "COUNT(") {
		t.Fatalf("queries = %q, want exactly the count query", queries)
	}
}

func TestRepository_ListPaymentOrdersPage_RejectsSkippingBothItemsAndTotal(t *testing.T) {
	repo := resetDB(t)

	_, _, err := repo.ListPaymentOrdersPage(context.Background(), PaymentOrderFilter{SkipItems: true, SkipTotal: true})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestRepository_AcknowledgePaymentOrder_UsesASingleStatement(t *testing.T) {
	cases := []struct {
		name       string
		status     string
		wantStatus string
		wantErr    error
	}{
		{name: "ready order is acknowledged", status: "READY", wantStatus: "ACKNOWLEDGED"},
		{name: "already acknowledged order is returned unchanged", status: "ACKNOWLEDGED", wantStatus: "ACKNOWLEDGED"},
		{name: "done order is rejected", status: "DONE", wantErr: ErrInvalidInput},
		{name: "cancelled order is rejected", status: "CANCELLED", wantErr: ErrInvalidInput},
		{name: "missing order is not found", wantErr: ErrNotFound},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			resetPaymentOrdersTable(t, ctx)
			if tc.status != "" {
				seedPOSPaymentOrder(t, ctx, "order-ack-rt", 11000, tc.status)
			}
			repo, recorder := newRecordingRepo(t)

			order, err := repo.AcknowledgePaymentOrder(ctx, "order-ack-rt")
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("error = %v, want %v", err, tc.wantErr)
				}
			} else {
				if err != nil {
					t.Fatalf("error = %v", err)
				}
				if order.Status != tc.wantStatus || order.OrderID != "order-ack-rt" || order.Amount != 11000 || order.CreatedAt == "" {
					t.Fatalf("order = %+v, want status %s with its stored fields", order, tc.wantStatus)
				}
			}

			queries, _ := recorder.snapshot()
			if len(queries) != 1 {
				t.Fatalf("queries = %d (%q), want 1", len(queries), queries)
			}
		})
	}
}

func TestRepository_SyncTossCatalog_BatchesOptionWritesAndSkipsIDLookup(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo, recorder := newRecordingRepo(t)

	items := []TossCatalogItem{
		{
			ID: "pos-a", Name: "A", CategoryID: "highball", Price: 1000, IsVisible: true, SortOrder: 1,
			Options: []TossCatalogOption{
				{ID: "opt-1", Title: "옵션1", Enabled: true, SortOrder: 1, Choices: []TossCatalogOptionChoice{
					{ID: "c-1", Title: "선택1", Enabled: true, State: "ON_SALE", SortOrder: 1},
					{ID: "c-2", Title: "선택2", Enabled: true, State: "ON_SALE", SortOrder: 2},
				}},
				{ID: "opt-2", Title: "옵션2", Enabled: true, SortOrder: 2, Choices: []TossCatalogOptionChoice{
					{ID: "c-3", Title: "선택3", Enabled: true, State: "ON_SALE", SortOrder: 1},
				}},
			},
		},
	}
	// First sync creates the item; the second takes the "already linked"
	// UPDATE path whose follow-up id lookup this test pins away.
	if _, err := repo.SyncTossCatalog(ctx, items); err != nil {
		t.Fatalf("first SyncTossCatalog() error = %v", err)
	}
	recorder.reset()

	result, err := repo.SyncTossCatalog(ctx, items)
	if err != nil {
		t.Fatalf("second SyncTossCatalog() error = %v", err)
	}
	if result.Updated != 1 || result.Created != 0 || result.Linked != 0 {
		t.Fatalf("result = %+v, want updated=1", result)
	}

	queries, batches := recorder.snapshot()
	for _, query := range queries {
		if strings.HasPrefix(query, "SELECT id FROM menu_items WHERE toss_catalog_item_id") {
			t.Errorf("sync ran a separate id lookup after UPDATE: %q", query)
		}
		for _, table := range []string{"INSERT INTO menu_options", "INSERT INTO menu_item_options", "INSERT INTO menu_option_choices"} {
			if strings.HasPrefix(query, table+" ") {
				t.Errorf("sync ran %q as its own round trip, want it batched", table)
			}
		}
	}
	if batches == 0 {
		t.Errorf("batches = 0, want option/choice upserts sent as a pgx.Batch")
	}

	var optionCount, linkCount, choiceCount int
	if err := testPool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM menu_options),
			(SELECT COUNT(*) FROM menu_item_options WHERE menu_item_id = 'toss-pos-a'),
			(SELECT COUNT(*) FROM menu_option_choices)
	`).Scan(&optionCount, &linkCount, &choiceCount); err != nil {
		t.Fatalf("count synced options: %v", err)
	}
	if optionCount != 2 || linkCount != 2 || choiceCount != 3 {
		t.Fatalf("options=%d links=%d choices=%d, want 2/2/3", optionCount, linkCount, choiceCount)
	}
}
