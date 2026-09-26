// Command backfill-payment-bills builds 계산서(pos_bills) and their
// payments (pos_payments) for web orders that reached TossPlace before bills
// existed, and completes the rows the old completion bug left READY or
// ACKNOWLEDGED on a paid table's POS order.
//
// It is a dry-run by default: it reads TossPlace and the database, prints
// what would change, and writes nothing (the database session is also put
// in read-only mode). Pass --apply to write. Re-running is safe.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

const defaultDelay = 200 * time.Millisecond

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], config.Load(), os.Stdout))
}

// run returns the process exit code: 0 when every order was handled, 1 on
// a fatal error or any per-order failure, 2 on bad usage.
func run(ctx context.Context, args []string, cfg config.Config, out io.Writer) int {
	flags := flag.NewFlagSet("backfill-payment-bills", flag.ContinueOnError)
	flags.SetOutput(out)
	apply := flags.Bool("apply", false, "실제로 DB에 반영한다 (기본은 dry-run: 조회와 변경 예정 출력만)")
	delay := flags.Duration("delay", defaultDelay, "TossPlace API 호출 사이 대기 시간")
	limit := flags.Int("limit", 0, "처리할 POS 주문 최대 수 (0 = 전체, 오래된 순)")
	offset := flags.Int("offset", 0, "앞에서부터 건너뛸 POS 주문 수 (배치 실행용)")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() > 0 || *delay < 0 || *limit < 0 || *offset < 0 {
		fmt.Fprintln(out, "usage: backfill-payment-bills [--apply] [--delay 200ms] [--limit N] [--offset N]")
		return 2
	}
	if cfg.TossPlaceAccessKey == "" || cfg.TossPlaceSecretKey == "" || cfg.TossPlaceMerchantID == "" {
		fmt.Fprintln(out, "TossPlace가 설정되지 않았습니다 (TOSS_PLACE_ACCESS_KEY, TOSS_PLACE_SECRET_KEY, TOSS_PLACE_MERCHANT_ID)")
		return 1
	}

	pool, err := openPool(ctx, cfg.DatabaseURL, cfg.DBStatementTimeout, !*apply)
	if err != nil {
		fmt.Fprintf(out, "DB 연결 실패: %v\n", err)
		return 1
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		fmt.Fprintf(out, "DB 연결 실패: %v\n", err)
		return 1
	}

	repo := store.New(pool)
	runner := &Runner{
		Source: dbSource{repo: repo, pool: pool},
		POS: tossplace.NewClient(cfg.TossPlaceAPIBaseURL, cfg.TossPlaceAccessKey, cfg.TossPlaceSecretKey,
			cfg.TossPlaceMerchantID, &http.Client{Timeout: 30 * time.Second}),
		Out: out,
	}
	if *apply {
		// Only apply mode gets a writer; dry-run has no path to one.
		runner.Writer = repo
	}

	summary, err := runner.Run(ctx, Options{Apply: *apply, Delay: *delay, Limit: *limit, Offset: *offset})
	if err != nil {
		fmt.Fprintf(out, "백필 실패: %v\n", err)
		return 1
	}
	if len(summary.Failures) > 0 || summary.Interrupted {
		return 1
	}
	return 0
}

// openPool mirrors store.NewPool's statement_timeout and, for dry-run,
// makes every transaction on the session read-only so Postgres itself
// rejects any write that slipped through.
func openPool(ctx context.Context, databaseURL string, statementTimeout time.Duration, readOnly bool) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	poolConfig.MaxConns = 2
	poolConfig.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		if statementTimeout > 0 {
			millis := strconv.FormatInt(statementTimeout.Milliseconds(), 10)
			if _, err := conn.Exec(ctx, `SELECT set_config('statement_timeout', $1, false)`, millis); err != nil {
				return err
			}
		}
		if readOnly {
			if _, err := conn.Exec(ctx, `SELECT set_config('default_transaction_read_only', 'on', false)`); err != nil {
				return err
			}
		}
		return nil
	}
	return pgxpool.NewWithConfig(ctx, poolConfig)
}
