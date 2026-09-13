package store

import (
	"context"
	"strings"
	"testing"
)

func TestRepository_RecordSystemErrorLog_And_ListSystemErrorLogs(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.RecordSystemErrorLog(ctx, "GET", "/api/v1/menu", 500, "boom"); err != nil {
		t.Fatalf("RecordSystemErrorLog() error = %v", err)
	}

	items, total, err := repo.ListSystemErrorLogs(ctx, 1, 20)
	if err != nil {
		t.Fatalf("ListSystemErrorLogs() error = %v", err)
	}
	if total != 1 || len(items) != 1 {
		t.Fatalf("total = %d, len(items) = %d, want 1 and 1", total, len(items))
	}

	item := items[0]
	if item.Method != "GET" || item.Path != "/api/v1/menu" || item.Status != 500 || item.Message != "boom" {
		t.Errorf("item = %+v, want method=GET path=/api/v1/menu status=500 message=boom", item)
	}
	if item.ID == "" {
		t.Error("expected item.ID to be populated")
	}
	if item.CreatedAt == "" {
		t.Error("expected item.CreatedAt to be populated")
	}
}

func TestRepository_ListSystemErrorLogs_OrderedNewestFirst(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.RecordSystemErrorLog(ctx, "GET", "/first", 500, "first"); err != nil {
		t.Fatalf("RecordSystemErrorLog(first) error = %v", err)
	}
	if err := repo.RecordSystemErrorLog(ctx, "GET", "/second", 500, "second"); err != nil {
		t.Fatalf("RecordSystemErrorLog(second) error = %v", err)
	}

	items, total, err := repo.ListSystemErrorLogs(ctx, 1, 20)
	if err != nil {
		t.Fatalf("ListSystemErrorLogs() error = %v", err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("total = %d, len(items) = %d, want 2 and 2", total, len(items))
	}
	if items[0].Path != "/second" || items[1].Path != "/first" {
		t.Errorf("order = [%s, %s], want [/second, /first]", items[0].Path, items[1].Path)
	}
}

func TestRepository_RecordSystemErrorLog_TruncatesLongMessage(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	longMessage := strings.Repeat("a", 3000)
	if err := repo.RecordSystemErrorLog(ctx, "GET", "/long", 500, longMessage); err != nil {
		t.Fatalf("RecordSystemErrorLog() error = %v", err)
	}

	items, _, err := repo.ListSystemErrorLogs(ctx, 1, 20)
	if err != nil {
		t.Fatalf("ListSystemErrorLogs() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("len(items) = %d, want 1", len(items))
	}
	if len(items[0].Message) > 2000 {
		t.Errorf("len(message) = %d, want <= 2000", len(items[0].Message))
	}
}

func TestRepository_RecordSystemErrorLog_EnforcesRetentionLimit(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `
		INSERT INTO system_error_logs (id, method, path, status, message, created_at)
		SELECT
			'seed-' || gs,
			'GET',
			'/seed/' || gs,
			500,
			'seed',
			NOW() - (gs || ' seconds')::interval
		FROM generate_series(1, 500) AS gs
	`); err != nil {
		t.Fatalf("seed system_error_logs: %v", err)
	}

	if err := repo.RecordSystemErrorLog(ctx, "GET", "/newest", 500, "newest"); err != nil {
		t.Fatalf("RecordSystemErrorLog() error = %v", err)
	}

	var count int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM system_error_logs`).Scan(&count); err != nil {
		t.Fatalf("count system_error_logs: %v", err)
	}
	if count != 500 {
		t.Errorf("count = %d, want 500", count)
	}

	var oldestStillExists bool
	if err := testPool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM system_error_logs WHERE id = 'seed-500')`).Scan(&oldestStillExists); err != nil {
		t.Fatalf("check oldest row: %v", err)
	}
	if oldestStillExists {
		t.Error("expected the oldest row (seed-500) to be pruned")
	}

	var newestExists bool
	if err := testPool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM system_error_logs WHERE path = '/newest')`).Scan(&newestExists); err != nil {
		t.Fatalf("check newest row: %v", err)
	}
	if !newestExists {
		t.Error("expected the newly recorded row to survive retention pruning")
	}
}
