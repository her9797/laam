package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/her9797/laam/laam-api/internal/store"
)

// This mirrors internal/store/docker_test.go: the integration tests start a
// throwaway postgres:16-alpine container, so they never touch a real
// database. Without Docker they are skipped.
var (
	testPool          *pgxpool.Pool
	testDSN           string
	dockerContainerID string
)

func TestMain(m *testing.M) {
	if _, err := exec.LookPath("docker"); err != nil {
		fmt.Println("docker not found in PATH; skipping backfill integration tests")
		os.Exit(m.Run())
	}

	ctx := context.Background()
	containerID, hostPort, err := startPostgresContainer(ctx)
	if err != nil {
		fmt.Println("failed to start postgres container:", err)
		os.Exit(1)
	}
	dockerContainerID = containerID
	testDSN = fmt.Sprintf("postgres://laam:laam@127.0.0.1:%s/laam_test?sslmode=disable", hostPort)

	pool, err := connectWithRetry(ctx, testDSN)
	if err != nil {
		stopPostgresContainer(dockerContainerID)
		fmt.Println("failed to connect to postgres container:", err)
		os.Exit(1)
	}
	testPool = pool
	if err := store.New(pool).EnsureSchema(ctx); err != nil {
		pool.Close()
		stopPostgresContainer(dockerContainerID)
		fmt.Println("failed to ensure schema:", err)
		os.Exit(1)
	}

	code := m.Run()

	pool.Close()
	stopPostgresContainer(dockerContainerID)
	os.Exit(code)
}

func startPostgresContainer(ctx context.Context) (string, string, error) {
	runCmd := exec.CommandContext(ctx, "docker", "run", "-d", "--rm",
		"-e", "POSTGRES_USER=laam",
		"-e", "POSTGRES_PASSWORD=laam",
		"-e", "POSTGRES_DB=laam_test",
		"-p", "127.0.0.1::5432",
		"postgres:16-alpine",
	)
	var stderr bytes.Buffer
	runCmd.Stderr = &stderr
	out, err := runCmd.Output()
	if err != nil {
		return "", "", fmt.Errorf("docker run failed: %w: %s", err, stderr.String())
	}
	containerID := strings.TrimSpace(string(out))

	portOut, err := exec.CommandContext(ctx, "docker", "port", containerID, "5432/tcp").CombinedOutput()
	if err != nil {
		stopPostgresContainer(containerID)
		return "", "", fmt.Errorf("docker port failed: %w: %s", err, string(portOut))
	}
	parts := strings.Split(strings.TrimSpace(strings.SplitN(string(portOut), "\n", 2)[0]), ":")
	return containerID, parts[len(parts)-1], nil
}

func stopPostgresContainer(containerID string) {
	if containerID != "" {
		_ = exec.Command("docker", "stop", containerID).Run()
	}
}

func connectWithRetry(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	deadline := time.Now().Add(30 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		pool, err := pgxpool.New(ctx, dsn)
		if err == nil {
			if lastErr = pool.Ping(ctx); lastErr == nil {
				return pool, nil
			}
			pool.Close()
		} else {
			lastErr = err
		}
		time.Sleep(500 * time.Millisecond)
	}
	return nil, fmt.Errorf("timed out waiting for postgres: %w", lastErr)
}

// resetTables empties the tables the backfill reads and writes.
func resetTables(t *testing.T) {
	t.Helper()
	if testPool == nil {
		t.Skip("docker not available; skipping integration test")
	}
	if _, err := testPool.Exec(context.Background(),
		`TRUNCATE pos_payments, pos_bills, payment_order_option_choices, payment_orders RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("truncate tables: %v", err)
	}
}
