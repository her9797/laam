package store

import (
	"context"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool creates the application's Postgres pool. A positive
// statementTimeout is applied as statement_timeout on every new connection
// so a runaway query is cancelled server-side instead of pinning a pooled
// connection; zero leaves the server/role default untouched.
//
// The value is set with set_config after connecting rather than as a
// startup parameter, because connection poolers (e.g. the Supabase pooler)
// may reject unknown startup parameters.
func NewPool(ctx context.Context, databaseURL string, statementTimeout time.Duration) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	if statementTimeout > 0 {
		timeoutMillis := strconv.FormatInt(statementTimeout.Milliseconds(), 10)
		poolConfig.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			_, err := conn.Exec(ctx, `SELECT set_config('statement_timeout', $1, false)`, timeoutMillis)
			return err
		}
	}
	return pgxpool.NewWithConfig(ctx, poolConfig)
}
