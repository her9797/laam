package store

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

func ptrInt64(value int64) *int64 { return &value }

func ptrInt(value int) *int { return &value }

// seedPOSSnapshot writes a POS table snapshot the same way a finished plugin
// sync would, without going through the sync request state machine.
func seedPOSSnapshot(t *testing.T, ctx context.Context, tables ...POSTableInput) {
	t.Helper()
	for _, table := range tables {
		if _, err := testPool.Exec(ctx, `
			INSERT INTO pos_tables (pos_table_id, title, hall_id, hall_name, capacity)
			VALUES ($1, $2, $3, $4, $5)
		`, table.ID, table.Title, table.HallID, nil, table.Capacity); err != nil {
			t.Fatalf("seed pos_tables: %v", err)
		}
	}
}

func qrTableByID(tables []QrTable, id string) (QrTable, bool) {
	for _, table := range tables {
		if table.ID == id {
			return table, true
		}
	}
	return QrTable{}, false
}

func TestEnsureSchema_SeedsFixedQrTableLayoutOnlyWhenEmpty(t *testing.T) {
	ctx := context.Background()
	resetDB(t)

	rows, err := testPool.Query(ctx, `SELECT id FROM qr_tables ORDER BY area, number`)
	if err != nil {
		t.Fatalf("query qr_tables: %v", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan: %v", err)
		}
		ids = append(ids, id)
	}
	rows.Close()

	want := []string{
		"B-01", "B-02", "B-03", "B-04", "B-05",
		"T-01", "T-02", "T-03", "T-04", "T-05",
		"T-06", "T-07", "T-08", "T-09", "T-10",
	}
	if len(ids) != len(want) {
		t.Fatalf("seeded ids = %v, want %v", ids, want)
	}
	for i, id := range want {
		if ids[i] != id {
			t.Fatalf("seeded ids = %v, want %v", ids, want)
		}
	}

	// A second EnsureSchema must neither duplicate nor reset existing rows.
	seedPOSSnapshot(t, ctx, POSTableInput{ID: 4001, Title: "테이블1"})
	if _, err := testPool.Exec(ctx, `UPDATE qr_tables SET pos_table_id = 4001, linked_at = NOW() WHERE id = 'T-01'`); err != nil {
		t.Fatalf("link T-01: %v", err)
	}
	if err := testRepo.EnsureSchema(ctx); err != nil {
		t.Fatalf("EnsureSchema() second run error = %v", err)
	}

	var count int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM qr_tables`).Scan(&count); err != nil {
		t.Fatalf("count qr_tables: %v", err)
	}
	if count != len(want) {
		t.Fatalf("qr_tables count after re-running EnsureSchema = %d, want %d", count, len(want))
	}
	var linked *int64
	if err := testPool.QueryRow(ctx, `SELECT pos_table_id FROM qr_tables WHERE id = 'T-01'`).Scan(&linked); err != nil {
		t.Fatalf("read T-01: %v", err)
	}
	if linked == nil || *linked != 4001 {
		t.Fatalf("T-01 pos_table_id = %v, want 4001", linked)
	}
}

func TestRepository_GetTableLinkOverview_ReturnsSeededTablesWithoutLinks(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	overview, err := repo.GetTableLinkOverview(ctx)
	if err != nil {
		t.Fatalf("GetTableLinkOverview() error = %v", err)
	}
	if len(overview.Tables) != 15 {
		t.Fatalf("len(Tables) = %d, want 15", len(overview.Tables))
	}
	if overview.Tables[0].ID != "B-01" || overview.Tables[14].ID != "T-10" {
		t.Fatalf("Tables order = %q..%q, want B-01..T-10", overview.Tables[0].ID, overview.Tables[14].ID)
	}
	if overview.Tables[0].POSTableID != nil || overview.Tables[0].POSTableTitle != nil {
		t.Fatalf("B-01 = %+v, want no link", overview.Tables[0])
	}
	if len(overview.POSOnlyTables) != 0 {
		t.Fatalf("len(POSOnlyTables) = %d, want 0", len(overview.POSOnlyTables))
	}
	if overview.LastSyncedAt != nil {
		t.Fatalf("LastSyncedAt = %v, want nil", overview.LastSyncedAt)
	}
	if overview.PendingSync != nil {
		t.Fatalf("PendingSync = %+v, want nil", overview.PendingSync)
	}
}

func TestRepository_CompletePOSTableSync_ReplacesSnapshotAndAutoLinks(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	// A stale snapshot row plus a link that must not survive the replacement.
	seedPOSSnapshot(t, ctx, POSTableInput{ID: 9001, Title: "사라질 테이블"})
	if _, err := testPool.Exec(ctx, `UPDATE qr_tables SET pos_table_id = 9001, linked_at = NOW() WHERE id = 'B-05'`); err != nil {
		t.Fatalf("seed stale link: %v", err)
	}

	request, created, err := repo.RequestPOSTableSync(ctx)
	if err != nil || !created {
		t.Fatalf("RequestPOSTableSync() = (%+v, %v, %v), want a new request", request, created, err)
	}
	syncID, err := repo.ClaimPOSTableSync(ctx)
	if err != nil {
		t.Fatalf("ClaimPOSTableSync() error = %v", err)
	}
	if syncID != request.ID {
		t.Fatalf("claimed %q, want %q", syncID, request.ID)
	}

	err = repo.CompletePOSTableSync(ctx, syncID, POSTableSnapshotInput{
		Halls: []POSHallInput{{ID: 1, Name: "1층"}, {ID: 2, Name: "2층"}},
		Tables: []POSTableInput{
			{ID: 101, Title: "테이블 1", HallID: ptrInt64(1), Capacity: ptrInt(4)},
			{ID: 102, Title: "t2", HallID: ptrInt64(1)},
			{ID: 103, Title: "바자리3", HallID: ptrInt64(2)},
			// Two POS tables claim B-01, so neither may be auto-linked.
			{ID: 104, Title: "b1", HallID: ptrInt64(2)},
			{ID: 105, Title: "바 1", HallID: ptrInt64(2)},
			{ID: 106, Title: "룸", HallID: ptrInt64(2)},
		},
	})
	if err != nil {
		t.Fatalf("CompletePOSTableSync() error = %v", err)
	}

	overview, err := repo.GetTableLinkOverview(ctx)
	if err != nil {
		t.Fatalf("GetTableLinkOverview() error = %v", err)
	}

	t01, _ := qrTableByID(overview.Tables, "T-01")
	if t01.POSTableID == nil || *t01.POSTableID != 101 {
		t.Fatalf("T-01 pos table = %v, want 101", t01.POSTableID)
	}
	if t01.POSTableTitle == nil || *t01.POSTableTitle != "테이블 1" {
		t.Fatalf("T-01 pos title = %v, want the snapshot title", t01.POSTableTitle)
	}
	if t01.HallName == nil || *t01.HallName != "1층" {
		t.Fatalf("T-01 hall = %v, want the hall name", t01.HallName)
	}
	if t01.LinkedAt == nil {
		t.Fatal("T-01 linkedAt = nil, want a timestamp")
	}
	t02, _ := qrTableByID(overview.Tables, "T-02")
	if t02.POSTableID == nil || *t02.POSTableID != 102 {
		t.Fatalf("T-02 pos table = %v, want 102", t02.POSTableID)
	}
	b03, _ := qrTableByID(overview.Tables, "B-03")
	if b03.POSTableID == nil || *b03.POSTableID != 103 {
		t.Fatalf("B-03 pos table = %v, want 103", b03.POSTableID)
	}
	b01, _ := qrTableByID(overview.Tables, "B-01")
	if b01.POSTableID != nil {
		t.Fatalf("B-01 pos table = %v, want nil (two candidates)", b01.POSTableID)
	}
	b05, _ := qrTableByID(overview.Tables, "B-05")
	if b05.POSTableID != nil {
		t.Fatalf("B-05 pos table = %v, want nil (POS table disappeared)", b05.POSTableID)
	}

	wantPOSOnly := map[int64]bool{104: true, 105: true, 106: true}
	if len(overview.POSOnlyTables) != len(wantPOSOnly) {
		t.Fatalf("POSOnlyTables = %+v, want %d entries", overview.POSOnlyTables, len(wantPOSOnly))
	}
	for _, table := range overview.POSOnlyTables {
		if !wantPOSOnly[table.POSTableID] {
			t.Fatalf("unexpected POS-only table %+v", table)
		}
		if table.QrTableID != nil {
			t.Fatalf("POS-only table %d qrTableId = %v, want nil", table.POSTableID, table.QrTableID)
		}
	}
	if overview.LastSyncedAt == nil {
		t.Fatal("LastSyncedAt = nil, want the snapshot time")
	}
	if overview.PendingSync != nil {
		t.Fatalf("PendingSync = %+v, want nil after completion", overview.PendingSync)
	}

	done, err := repo.GetPOSTableSync(ctx, syncID)
	if err != nil {
		t.Fatalf("GetPOSTableSync() error = %v", err)
	}
	if done.Status != "DONE" {
		t.Fatalf("Status = %q, want DONE", done.Status)
	}
	if done.LinkedCount != 3 || done.UnlinkedCount != 0 || done.POSOnlyCount != 3 {
		t.Fatalf("counts = (%d, %d, %d), want (3, 0, 3)", done.LinkedCount, done.UnlinkedCount, done.POSOnlyCount)
	}
	if done.CompletedAt == nil {
		t.Fatal("CompletedAt = nil, want a timestamp")
	}

	// A second sync replaces the snapshot wholesale.
	second, _, err := repo.RequestPOSTableSync(ctx)
	if err != nil {
		t.Fatalf("RequestPOSTableSync() error = %v", err)
	}
	if _, err := repo.ClaimPOSTableSync(ctx); err != nil {
		t.Fatalf("ClaimPOSTableSync() error = %v", err)
	}
	if err := repo.CompletePOSTableSync(ctx, second.ID, POSTableSnapshotInput{
		Tables: []POSTableInput{{ID: 101, Title: "테이블 1"}},
	}); err != nil {
		t.Fatalf("CompletePOSTableSync() second error = %v", err)
	}
	overview, err = repo.GetTableLinkOverview(ctx)
	if err != nil {
		t.Fatalf("GetTableLinkOverview() error = %v", err)
	}
	if len(overview.POSOnlyTables) != 0 {
		t.Fatalf("POSOnlyTables = %+v, want empty", overview.POSOnlyTables)
	}
	t02, _ = qrTableByID(overview.Tables, "T-02")
	if t02.POSTableID != nil {
		t.Fatalf("T-02 pos table = %v, want nil after the POS table disappeared", t02.POSTableID)
	}
}

func TestRepository_CompletePOSTableSync_RejectsTooManyTables(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	request, _, err := repo.RequestPOSTableSync(ctx)
	if err != nil {
		t.Fatalf("RequestPOSTableSync() error = %v", err)
	}
	if _, err := repo.ClaimPOSTableSync(ctx); err != nil {
		t.Fatalf("ClaimPOSTableSync() error = %v", err)
	}

	tables := make([]POSTableInput, 0, MaxPOSTableSnapshotTables+1)
	for i := 0; i <= MaxPOSTableSnapshotTables; i++ {
		tables = append(tables, POSTableInput{ID: int64(i + 1), Title: "룸"})
	}
	if err := repo.CompletePOSTableSync(ctx, request.ID, POSTableSnapshotInput{Tables: tables}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("CompletePOSTableSync() error = %v, want ErrInvalidInput", err)
	}
}

func TestRepository_RequestPOSTableSync_KeepsASinglePendingRequest(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	first, created, err := repo.RequestPOSTableSync(ctx)
	if err != nil || !created {
		t.Fatalf("RequestPOSTableSync() = (%+v, %v, %v), want a new request", first, created, err)
	}
	if first.Status != "PENDING" {
		t.Fatalf("Status = %q, want PENDING", first.Status)
	}

	second, created, err := repo.RequestPOSTableSync(ctx)
	if err != nil {
		t.Fatalf("RequestPOSTableSync() error = %v", err)
	}
	if created {
		t.Fatal("second RequestPOSTableSync() created a new request, want the pending one")
	}
	if second.ID != first.ID {
		t.Fatalf("second id = %q, want %q", second.ID, first.ID)
	}

	// A claimed (RUNNING) request also blocks a new one.
	if _, err := repo.ClaimPOSTableSync(ctx); err != nil {
		t.Fatalf("ClaimPOSTableSync() error = %v", err)
	}
	third, created, err := repo.RequestPOSTableSync(ctx)
	if err != nil {
		t.Fatalf("RequestPOSTableSync() error = %v", err)
	}
	if created || third.ID != first.ID || third.Status != "RUNNING" {
		t.Fatalf("third = (%+v, %v), want the running request", third, created)
	}
}

func TestRepository_RequestPOSTableSync_IsSingleUnderConcurrency(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	var wg sync.WaitGroup
	errs := make([]error, 8)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, err := repo.RequestPOSTableSync(ctx)
			errs[i] = err
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("RequestPOSTableSync() [%d] error = %v", i, err)
		}
	}

	var count int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM pos_table_sync_requests`).Scan(&count); err != nil {
		t.Fatalf("count requests: %v", err)
	}
	if count != 1 {
		t.Fatalf("pos_table_sync_requests count = %d, want 1", count)
	}
}

func TestRepository_GetPOSTableSync_MarksStaleRequestTimedOut(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	request, _, err := repo.RequestPOSTableSync(ctx)
	if err != nil {
		t.Fatalf("RequestPOSTableSync() error = %v", err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE pos_table_sync_requests SET requested_at = NOW() - INTERVAL '31 seconds' WHERE id = $1`, request.ID); err != nil {
		t.Fatalf("age request: %v", err)
	}

	timedOut, err := repo.GetPOSTableSync(ctx, request.ID)
	if err != nil {
		t.Fatalf("GetPOSTableSync() error = %v", err)
	}
	if timedOut.Status != "TIMED_OUT" {
		t.Fatalf("Status = %q, want TIMED_OUT", timedOut.Status)
	}
	if timedOut.Error == nil || *timedOut.Error == "" {
		t.Fatal("Error = nil, want a timeout message")
	}

	// The listing must agree, and a timed-out request no longer blocks a new one.
	overview, err := repo.GetTableLinkOverview(ctx)
	if err != nil {
		t.Fatalf("GetTableLinkOverview() error = %v", err)
	}
	if overview.PendingSync != nil {
		t.Fatalf("PendingSync = %+v, want nil", overview.PendingSync)
	}
	next, created, err := repo.RequestPOSTableSync(ctx)
	if err != nil || !created || next.ID == request.ID {
		t.Fatalf("RequestPOSTableSync() = (%+v, %v, %v), want a fresh request", next, created, err)
	}
}

func TestRepository_ClaimPOSTableSync_ReturnsNotFoundWhenNothingPending(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	if _, err := repo.ClaimPOSTableSync(ctx); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ClaimPOSTableSync() error = %v, want ErrNotFound", err)
	}

	request, _, err := repo.RequestPOSTableSync(ctx)
	if err != nil {
		t.Fatalf("RequestPOSTableSync() error = %v", err)
	}
	if _, err := repo.ClaimPOSTableSync(ctx); err != nil {
		t.Fatalf("ClaimPOSTableSync() error = %v", err)
	}
	// Already claimed: nothing left to hand out.
	if _, err := repo.ClaimPOSTableSync(ctx); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second ClaimPOSTableSync() error = %v, want ErrNotFound", err)
	}

	running, err := repo.GetPOSTableSync(ctx, request.ID)
	if err != nil {
		t.Fatalf("GetPOSTableSync() error = %v", err)
	}
	if running.Status != "RUNNING" {
		t.Fatalf("Status = %q, want RUNNING", running.Status)
	}
}

func TestRepository_FailPOSTableSync_RecordsError(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	request, _, err := repo.RequestPOSTableSync(ctx)
	if err != nil {
		t.Fatalf("RequestPOSTableSync() error = %v", err)
	}
	if _, err := repo.ClaimPOSTableSync(ctx); err != nil {
		t.Fatalf("ClaimPOSTableSync() error = %v", err)
	}
	if err := repo.FailPOSTableSync(ctx, request.ID, "POS 테이블 목록을 읽지 못했습니다"); err != nil {
		t.Fatalf("FailPOSTableSync() error = %v", err)
	}

	failed, err := repo.GetPOSTableSync(ctx, request.ID)
	if err != nil {
		t.Fatalf("GetPOSTableSync() error = %v", err)
	}
	if failed.Status != "FAILED" {
		t.Fatalf("Status = %q, want FAILED", failed.Status)
	}
	if failed.Error == nil || *failed.Error != "POS 테이블 목록을 읽지 못했습니다" {
		t.Fatalf("Error = %v, want the reported message", failed.Error)
	}

	if err := repo.FailPOSTableSync(ctx, "no-such-sync", "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("FailPOSTableSync() unknown id error = %v, want ErrNotFound", err)
	}
}

func TestRepository_LinkQrTablePOSTable_ManualLinkAndUnlink(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)
	seedPOSSnapshot(t, ctx,
		POSTableInput{ID: 201, Title: "룸 A"},
		POSTableInput{ID: 202, Title: "테라스"},
	)

	linked, err := repo.LinkQrTablePOSTable(ctx, "T-07", ptrInt64(201))
	if err != nil {
		t.Fatalf("LinkQrTablePOSTable() error = %v", err)
	}
	if linked.POSTableID == nil || *linked.POSTableID != 201 {
		t.Fatalf("pos table = %v, want 201", linked.POSTableID)
	}
	if linked.POSTableTitle == nil || *linked.POSTableTitle != "룸 A" {
		t.Fatalf("pos title = %v, want the snapshot title", linked.POSTableTitle)
	}

	if _, err := repo.LinkQrTablePOSTable(ctx, "T-08", ptrInt64(201)); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("linking an already linked POS table error = %v, want ErrAlreadyExists", err)
	}
	if _, err := repo.LinkQrTablePOSTable(ctx, "T-08", ptrInt64(999)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("linking a POS table outside the snapshot error = %v, want ErrNotFound", err)
	}
	if _, err := repo.LinkQrTablePOSTable(ctx, "Z-99", ptrInt64(202)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("linking an unknown QR table error = %v, want ErrNotFound", err)
	}

	// Re-linking the same pair is not a conflict.
	if _, err := repo.LinkQrTablePOSTable(ctx, "T-07", ptrInt64(201)); err != nil {
		t.Fatalf("re-linking the same pair error = %v", err)
	}

	unlinked, err := repo.LinkQrTablePOSTable(ctx, "T-07", nil)
	if err != nil {
		t.Fatalf("unlink error = %v", err)
	}
	if unlinked.POSTableID != nil || unlinked.LinkedAt != nil || unlinked.POSTableTitle != nil {
		t.Fatalf("unlinked = %+v, want no link", unlinked)
	}
	if _, err := repo.LinkQrTablePOSTable(ctx, "Z-99", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unlinking an unknown QR table error = %v, want ErrNotFound", err)
	}
}

func TestRepository_CreateQrTable_GeneratesIDFromPOSTitle(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)
	seedPOSSnapshot(t, ctx,
		POSTableInput{ID: 301, Title: "테이블 11"},
		POSTableInput{ID: 302, Title: "룸 A"},
		POSTableInput{ID: 303, Title: "바자리 7"},
		POSTableInput{ID: 304, Title: "테이블 12"},
	)

	created, err := repo.CreateQrTable(ctx, "", 301)
	if err != nil {
		t.Fatalf("CreateQrTable() error = %v", err)
	}
	if created.ID != "T-11" || created.Area != "T" || created.Number != 11 {
		t.Fatalf("created = %+v, want T-11", created)
	}
	if created.POSTableID == nil || *created.POSTableID != 301 {
		t.Fatalf("pos table = %v, want 301", created.POSTableID)
	}

	if _, err := repo.CreateQrTable(ctx, "", 302); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("auto id from a room name error = %v, want ErrInvalidInput", err)
	}
	manual, err := repo.CreateQrTable(ctx, "R-01", 302)
	if err != nil {
		t.Fatalf("CreateQrTable() with explicit id error = %v", err)
	}
	if manual.ID != "R-01" || manual.Area != "R" || manual.Number != 1 {
		t.Fatalf("manual = %+v, want R-01", manual)
	}

	for _, badID := range []string{"t-01", "T-1", "T01", "T-001", "테이블"} {
		if _, err := repo.CreateQrTable(ctx, badID, 303); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("CreateQrTable(%q) error = %v, want ErrInvalidInput", badID, err)
		}
	}
	if _, err := repo.CreateQrTable(ctx, "T-01", 303); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("duplicate id error = %v, want ErrAlreadyExists", err)
	}
	if _, err := repo.CreateQrTable(ctx, "T-12", 301); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("already linked POS table error = %v, want ErrAlreadyExists", err)
	}
	if _, err := repo.CreateQrTable(ctx, "T-12", 999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("POS table outside the snapshot error = %v, want ErrNotFound", err)
	}

	overview, err := repo.GetTableLinkOverview(ctx)
	if err != nil {
		t.Fatalf("GetTableLinkOverview() error = %v", err)
	}
	if len(overview.Tables) != 17 {
		t.Fatalf("len(Tables) = %d, want 17", len(overview.Tables))
	}
	if overview.Tables[len(overview.Tables)-1].ID != "T-11" {
		t.Fatalf("last table = %q, want T-11 (area, number order)", overview.Tables[len(overview.Tables)-1].ID)
	}
}

func TestRepository_GetPOSTableMappings(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	mappings, err := repo.GetPOSTableMappings(ctx)
	if err != nil {
		t.Fatalf("GetPOSTableMappings() error = %v", err)
	}
	if len(mappings.Mappings) != 0 || mappings.UpdatedAt != nil {
		t.Fatalf("mappings = %+v, want empty", mappings)
	}

	seedPOSSnapshot(t, ctx, POSTableInput{ID: 401, Title: "룸 A"}, POSTableInput{ID: 402, Title: "테라스"})
	if _, err := repo.LinkQrTablePOSTable(ctx, "T-03", ptrInt64(401)); err != nil {
		t.Fatalf("link: %v", err)
	}

	mappings, err = repo.GetPOSTableMappings(ctx)
	if err != nil {
		t.Fatalf("GetPOSTableMappings() error = %v", err)
	}
	if len(mappings.Mappings) != 1 || mappings.Mappings["T-03"] != 401 {
		t.Fatalf("mappings = %+v, want a single T-03 entry", mappings.Mappings)
	}
	if mappings.UpdatedAt == nil {
		t.Fatal("UpdatedAt = nil, want the last link time")
	}
}

func seedOrderableMenuItem(t *testing.T, ctx context.Context) string {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO menu_categories (id, label, is_visible, sort_order) VALUES ('highball', '하이볼', TRUE, 1);
		INSERT INTO menu_items (id, toss_catalog_item_id, category_id, name, description, price, is_visible, sort_order)
		VALUES ('earlgrey', '7001', 'highball', '얼그레이 하이볼', '설명', '11,000원', TRUE, 1);
	`); err != nil {
		t.Fatalf("seed menu: %v", err)
	}
	return "earlgrey"
}

func TestRepository_CreatePaymentOrder_BlocksUnlinkedTableOnlyWhenLinksExist(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)
	menuItemID := seedOrderableMenuItem(t, ctx)

	// No QR table is linked yet: ordering keeps working exactly as before.
	if _, err := repo.CreatePaymentOrder(ctx, menuItemID, "T-02", "", nil); err != nil {
		t.Fatalf("CreatePaymentOrder() with no links error = %v, want nil", err)
	}

	seedPOSSnapshot(t, ctx, POSTableInput{ID: 501, Title: "테이블 1"})
	if _, err := repo.LinkQrTablePOSTable(ctx, "T-01", ptrInt64(501)); err != nil {
		t.Fatalf("link T-01: %v", err)
	}

	if _, err := repo.CreatePaymentOrder(ctx, menuItemID, "T-01", "", nil); err != nil {
		t.Fatalf("CreatePaymentOrder() for the linked table error = %v, want nil", err)
	}
	if _, err := repo.CreatePaymentOrder(ctx, menuItemID, "T-02", "", nil); !errors.Is(err, ErrTableNotLinked) {
		t.Fatalf("CreatePaymentOrder() for an unlinked table error = %v, want ErrTableNotLinked", err)
	}
	if _, err := repo.CreatePaymentOrder(ctx, menuItemID, "없는 테이블", "", nil); !errors.Is(err, ErrTableNotLinked) {
		t.Fatalf("CreatePaymentOrder() for an unknown table error = %v, want ErrTableNotLinked", err)
	}
}

// An operator must be able to correct a QR table's own code — the seeded
// layout guessed wrong, or a table created from POS landed on the wrong
// number — without losing the POS link it already carries.
func TestRepository_RenameQrTable_KeepsPOSLink(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)
	seedPOSSnapshot(t, ctx, POSTableInput{ID: 401, Title: "바6"})

	if _, err := repo.LinkQrTablePOSTable(ctx, "T-10", ptrInt64(401)); err != nil {
		t.Fatalf("LinkQrTablePOSTable() error = %v", err)
	}

	renamed, err := repo.RenameQrTable(ctx, "T-10", "B-06")
	if err != nil {
		t.Fatalf("RenameQrTable() error = %v", err)
	}
	if renamed.ID != "B-06" || renamed.Area != "B" || renamed.Number != 6 {
		t.Fatalf("renamed = %+v, want B-06", renamed)
	}
	if renamed.POSTableID == nil || *renamed.POSTableID != 401 {
		t.Fatalf("pos table = %v, want the link to survive the rename", renamed.POSTableID)
	}
	if renamed.POSTableTitle == nil || *renamed.POSTableTitle != "바6" {
		t.Fatalf("pos title = %v, want 바6", renamed.POSTableTitle)
	}
	if renamed.LinkedAt == nil {
		t.Fatalf("linkedAt = nil, want the original link timestamp")
	}

	if _, err := repo.LinkQrTablePOSTable(ctx, "T-10", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old id lookup error = %v, want ErrNotFound", err)
	}
}

func TestRepository_RenameQrTable_RejectsBadAndDuplicateIDs(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	if _, err := repo.RenameQrTable(ctx, "T-01", "t1"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("malformed id error = %v, want ErrInvalidInput", err)
	}
	if _, err := repo.RenameQrTable(ctx, "T-01", "T-02"); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("duplicate id error = %v, want ErrAlreadyExists", err)
	}
	if _, err := repo.RenameQrTable(ctx, "Z-99", "T-20"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown table error = %v, want ErrNotFound", err)
	}

	// Renaming to its own id is a no-op, not a conflict.
	same, err := repo.RenameQrTable(ctx, "T-01", "T-01")
	if err != nil {
		t.Fatalf("self rename error = %v", err)
	}
	if same.ID != "T-01" {
		t.Fatalf("same = %+v, want T-01", same)
	}
}

// The POS is the source of truth for which tables exist: a sync creates a QR
// table for every POS table whose name converts, and drops QR tables the POS
// no longer has. Our side only owns the code.
func TestRepository_CompletePOSTableSync_MirrorsPOSTables(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	// The seeded layout has B-01..B-05 and T-01..T-10; the POS only has three
	// of them plus a room whose name follows no rule.
	request, _, err := repo.RequestPOSTableSync(ctx)
	if err != nil {
		t.Fatalf("RequestPOSTableSync() error = %v", err)
	}
	if _, err := repo.ClaimPOSTableSync(ctx); err != nil {
		t.Fatalf("ClaimPOSTableSync() error = %v", err)
	}
	if err := repo.CompletePOSTableSync(ctx, request.ID, POSTableSnapshotInput{
		Halls: []POSHallInput{{ID: 1, Name: "1층 홀"}},
		Tables: []POSTableInput{
			{ID: 601, Title: "테이블 1", HallID: ptrInt64(1)},
			{ID: 602, Title: "테이블 2", HallID: ptrInt64(1)},
			{ID: 611, Title: "바1", HallID: ptrInt64(1)},
			{ID: 621, Title: "룸 A", HallID: ptrInt64(1)},
		},
	}); err != nil {
		t.Fatalf("CompletePOSTableSync() error = %v", err)
	}

	overview, err := repo.GetTableLinkOverview(ctx)
	if err != nil {
		t.Fatalf("GetTableLinkOverview() error = %v", err)
	}

	gotIDs := make([]string, 0, len(overview.Tables))
	for _, table := range overview.Tables {
		gotIDs = append(gotIDs, table.ID)
		if table.POSTableID == nil {
			t.Fatalf("%s has no POS table; unlinked QR tables must be dropped", table.ID)
		}
	}
	want := "B-01,T-01,T-02"
	if strings.Join(gotIDs, ",") != want {
		t.Fatalf("tables = %v, want %v", gotIDs, want)
	}

	// A POS table whose name follows no rule still needs an operator to pick
	// the code, so it stays in the POS-only list.
	if len(overview.POSOnlyTables) != 1 || overview.POSOnlyTables[0].Title != "룸 A" {
		t.Fatalf("posOnlyTables = %+v, want just 룸 A", overview.POSOnlyTables)
	}
}

// A code an operator corrected must survive the next sync: the POS table is
// still there, so the link — and the code we gave it — stays.
func TestRepository_CompletePOSTableSync_KeepsOperatorCodes(t *testing.T) {
	ctx := context.Background()
	repo := resetDB(t)

	snapshot := POSTableSnapshotInput{
		Halls:  []POSHallInput{{ID: 1, Name: "1층 홀"}},
		Tables: []POSTableInput{{ID: 701, Title: "바6", HallID: ptrInt64(1)}},
	}
	syncOnce := func() {
		t.Helper()
		request, _, err := repo.RequestPOSTableSync(ctx)
		if err != nil {
			t.Fatalf("RequestPOSTableSync() error = %v", err)
		}
		if _, err := repo.ClaimPOSTableSync(ctx); err != nil {
			t.Fatalf("ClaimPOSTableSync() error = %v", err)
		}
		if err := repo.CompletePOSTableSync(ctx, request.ID, snapshot); err != nil {
			t.Fatalf("CompletePOSTableSync() error = %v", err)
		}
	}

	syncOnce()
	renamed, err := repo.RenameQrTable(ctx, "B-06", "R-01")
	if err != nil {
		t.Fatalf("RenameQrTable() error = %v", err)
	}
	if renamed.ID != "R-01" {
		t.Fatalf("renamed = %+v, want R-01", renamed)
	}

	syncOnce()
	overview, err := repo.GetTableLinkOverview(ctx)
	if err != nil {
		t.Fatalf("GetTableLinkOverview() error = %v", err)
	}
	if len(overview.Tables) != 1 || overview.Tables[0].ID != "R-01" {
		t.Fatalf("tables = %+v, want the operator code R-01 to survive", overview.Tables)
	}
}
