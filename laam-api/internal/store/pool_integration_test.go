package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestNewPool_AppliesStatementTimeoutToEveryConnection(t *testing.T) {
	resetDB(t)
	ctx := context.Background()

	pool, err := NewPool(ctx, testPool.Config().ConnString(), 200*time.Millisecond)
	if err != nil {
		t.Fatalf("NewPool() error = %v", err)
	}
	defer pool.Close()

	var setting string
	if err := pool.QueryRow(ctx, `SHOW statement_timeout`).Scan(&setting); err != nil {
		t.Fatalf("show statement_timeout: %v", err)
	}
	if setting != "200ms" {
		t.Errorf("statement_timeout = %q, want %q", setting, "200ms")
	}

	_, err = pool.Exec(ctx, `SELECT pg_sleep(2)`)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "57014" {
		t.Errorf("pg_sleep(2) error = %v, want query_canceled (57014) from statement_timeout", err)
	}
}

func TestNewPool_ZeroStatementTimeoutKeepsServerDefault(t *testing.T) {
	resetDB(t)
	ctx := context.Background()

	pool, err := NewPool(ctx, testPool.Config().ConnString(), 0)
	if err != nil {
		t.Fatalf("NewPool() error = %v", err)
	}
	defer pool.Close()

	var setting string
	if err := pool.QueryRow(ctx, `SHOW statement_timeout`).Scan(&setting); err != nil {
		t.Fatalf("show statement_timeout: %v", err)
	}
	if setting != "0" {
		t.Errorf("statement_timeout = %q, want server default %q", setting, "0")
	}
}
