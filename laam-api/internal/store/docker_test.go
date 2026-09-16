package store

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
)

var (
	testPool          *pgxpool.Pool
	testRepo          *Repository
	dockerContainerID string
)

func TestMain(m *testing.M) {
	if _, err := exec.LookPath("docker"); err != nil {
		fmt.Println("docker not found in PATH; skipping store integration tests")
		os.Exit(0)
	}

	ctx := context.Background()

	containerID, hostPort, err := startPostgresContainer(ctx)
	if err != nil {
		fmt.Println("failed to start postgres container:", err)
		os.Exit(1)
	}
	dockerContainerID = containerID

	pool, err := connectWithRetry(ctx, hostPort)
	if err != nil {
		stopPostgresContainer(dockerContainerID)
		fmt.Println("failed to connect to postgres container:", err)
		os.Exit(1)
	}
	testPool = pool
	testRepo = New(pool)

	if err := testRepo.EnsureSchema(ctx); err != nil {
		pool.Close()
		stopPostgresContainer(dockerContainerID)
		fmt.Println("failed to ensure schema:", err)
		os.Exit(1)
	}
	if err := testRepo.SeedDefaults(ctx); err != nil {
		pool.Close()
		stopPostgresContainer(dockerContainerID)
		fmt.Println("failed to seed defaults:", err)
		os.Exit(1)
	}

	code := m.Run()

	pool.Close()
	stopPostgresContainer(dockerContainerID)
	os.Exit(code)
}

func startPostgresContainer(ctx context.Context) (containerID string, hostPort string, err error) {
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
	containerID = strings.TrimSpace(string(out))

	portCmd := exec.CommandContext(ctx, "docker", "port", containerID, "5432/tcp")
	portOut, err := portCmd.CombinedOutput()
	if err != nil {
		stopPostgresContainer(containerID)
		return "", "", fmt.Errorf("docker port failed: %w: %s", err, string(portOut))
	}

	mapping := strings.TrimSpace(string(portOut))
	parts := strings.Split(mapping, ":")
	hostPort = parts[len(parts)-1]

	return containerID, hostPort, nil
}

func stopPostgresContainer(containerID string) {
	if containerID == "" {
		return
	}
	_ = exec.Command("docker", "stop", containerID).Run()
}

func connectWithRetry(ctx context.Context, hostPort string) (*pgxpool.Pool, error) {
	dsn := fmt.Sprintf("postgres://laam:laam@127.0.0.1:%s/laam_test?sslmode=disable", hostPort)

	deadline := time.Now().Add(30 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		pool, err := pgxpool.New(ctx, dsn)
		if err == nil {
			if pingErr := pool.Ping(ctx); pingErr == nil {
				return pool, nil
			} else {
				lastErr = pingErr
				pool.Close()
			}
		} else {
			lastErr = err
		}
		time.Sleep(500 * time.Millisecond)
	}

	return nil, fmt.Errorf("timed out waiting for postgres: %w", lastErr)
}

// resetDB truncates all tables and seeds a minimal store_profile row so each
// test starts from a known, isolated state.
func resetDB(t *testing.T) *Repository {
	t.Helper()
	if testRepo == nil {
		t.Skip("docker not available; skipping integration test")
	}

	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `TRUNCATE payment_order_option_choices, payment_orders, menu_item_options, menu_option_choices, menu_options, menu_item_images, menu_items, menu_categories, request_guides, notices, song_playback_queue, customer_requests, special_requests, system_error_logs, store_profile RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("truncate tables: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO store_profile (id, name, subtitle, address, song_request_copy, request_copy, event_copy)
		VALUES (1, 'Test Store', 'test subtitle', 'test address', 'song copy', 'request copy', 'event copy')
	`); err != nil {
		t.Fatalf("seed store_profile: %v", err)
	}

	return testRepo
}
