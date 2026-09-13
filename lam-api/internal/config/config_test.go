package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_ReadsRepositoryDotEnvWhenRunningFromLamAPI(t *testing.T) {
	repositoryDir := t.TempDir()
	apiDir := filepath.Join(repositoryDir, "lam-api")
	if err := os.Mkdir(apiDir, 0o755); err != nil {
		t.Fatalf("create lam-api directory: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(repositoryDir, ".env"),
		[]byte(
			"DATABASE_URL='postgresql://user:encoded-password@db.example.com:5432/postgres?sslmode=require'\n"+
				"TOSS_PLACE_ACCESS_KEY=toss-access\n"+
				"TOSS_PLACE_SECRET_KEY=toss-secret\n"+
				"TOSS_PLACE_MERCHANT_ID=merchant-123\n",
		),
		0o600,
	); err != nil {
		t.Fatalf("write repository .env: %v", err)
	}

	t.Chdir(apiDir)
	t.Setenv("DATABASE_URL", "")
	t.Setenv("TOSS_PLACE_ACCESS_KEY", "")
	t.Setenv("TOSS_PLACE_SECRET_KEY", "")
	t.Setenv("TOSS_PLACE_MERCHANT_ID", "")

	cfg := Load()

	if cfg.DatabaseURL != "postgresql://user:encoded-password@db.example.com:5432/postgres?sslmode=require" {
		t.Errorf("DatabaseURL = %q, want value loaded from repository .env", cfg.DatabaseURL)
	}
	if cfg.TossPlaceAccessKey != "toss-access" || cfg.TossPlaceSecretKey != "toss-secret" || cfg.TossPlaceMerchantID != "merchant-123" {
		t.Error("Toss Place configuration was not loaded from repository .env")
	}
}

// TestLoad_ReadsEveryKnownKeyFromDotEnv guards against the local .env loader
// silently ignoring a key: it previously only loaded a fixed allowlist, so a
// key absent from that list (e.g. TOSS_PLACE_WEBHOOK_SECRET) stayed empty
// even when `go run` was launched without `source .env` first and the key
// was right there in the file — plain `go run ./cmd/server` still 401'd
// every TossPlace webhook, QR_SIGNING_SECRET 500'd the admin tables
// endpoint, etc. This test seeds every key the loader is documented to
// read and asserts each one actually reaches Config.
func TestLoad_ReadsEveryKnownKeyFromDotEnv(t *testing.T) {
	repositoryDir := t.TempDir()
	apiDir := filepath.Join(repositoryDir, "lam-api")
	if err := os.Mkdir(apiDir, 0o755); err != nil {
		t.Fatalf("create lam-api directory: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(repositoryDir, ".env"),
		[]byte(
			"QR_SIGNING_SECRET=qr-secret\n"+
				"CUSTOMER_WEB_BASE_URL=https://guest.example.com\n"+
				"TOSS_PLACE_WEBHOOK_SECRET=webhook-secret\n",
		),
		0o600,
	); err != nil {
		t.Fatalf("write repository .env: %v", err)
	}

	t.Chdir(apiDir)
	t.Setenv("QR_SIGNING_SECRET", "")
	t.Setenv("CUSTOMER_WEB_BASE_URL", "")
	t.Setenv("TOSS_PLACE_WEBHOOK_SECRET", "")

	cfg := Load()

	if cfg.QRSigningSecret != "qr-secret" {
		t.Errorf("QRSigningSecret = %q, want %q", cfg.QRSigningSecret, "qr-secret")
	}
	if cfg.CustomerWebBaseURL != "https://guest.example.com" {
		t.Errorf("CustomerWebBaseURL = %q, want %q", cfg.CustomerWebBaseURL, "https://guest.example.com")
	}
	if cfg.TossPlaceWebhookSecret != "webhook-secret" {
		t.Errorf("TossPlaceWebhookSecret = %q, want %q", cfg.TossPlaceWebhookSecret, "webhook-secret")
	}
}

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("APP_ADDR", "")
	t.Setenv("PORT", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("ALLOWED_ORIGIN", "")
	t.Setenv("ADMIN_API_TOKEN", "")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_BROADCAST_KEY", "")
	t.Setenv("PAYMENT_API_TOKEN", "")
	t.Setenv("TOSS_PAYMENTS_SECRET_KEY", "")
	t.Setenv("TOSS_PAYMENTS_API_BASE_URL", "")
	t.Setenv("TOSS_PLACE_ACCESS_KEY", "")
	t.Setenv("TOSS_PLACE_SECRET_KEY", "")
	t.Setenv("TOSS_PLACE_MERCHANT_ID", "")
	t.Setenv("TOSS_PLACE_API_BASE_URL", "")
	t.Setenv("POS_ORDER_PROVIDER", "")
	t.Setenv("POS_PLUGIN_API_TOKEN", "")
	t.Setenv("YOUTUBE_API_KEY", "")
	t.Setenv("YOUTUBE_API_BASE_URL", "")

	cfg := Load()

	if cfg.Addr != ":9090" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, ":9090")
	}
	if cfg.DatabaseURL != "postgres://lam:lam@127.0.0.1:5432/lam?sslmode=disable" {
		t.Errorf("DatabaseURL = %q, want default local postgres URL", cfg.DatabaseURL)
	}
	if cfg.AllowedOrigin != "*" {
		t.Errorf("AllowedOrigin = %q, want %q", cfg.AllowedOrigin, "*")
	}
	if cfg.AdminAPIToken != "lam-admin-api-token" {
		t.Errorf("AdminAPIToken = %q, want %q", cfg.AdminAPIToken, "lam-admin-api-token")
	}
	// Deliberately empty by default (not a fabricated placeholder like the
	// other fields above): local docker-compose has no Supabase project,
	// and an empty SupabaseBroadcastKey is exactly what
	// internal/notify.Broadcaster checks to skip sending — see
	// docs/plans/2026-09-04-admin-request-notifications.md section 5.1.
	if cfg.SupabaseURL != "" {
		t.Errorf("SupabaseURL = %q, want empty default", cfg.SupabaseURL)
	}
	if cfg.SupabaseBroadcastKey != "" {
		t.Errorf("SupabaseBroadcastKey = %q, want empty default", cfg.SupabaseBroadcastKey)
	}
	if cfg.PaymentAPIToken != "lam-payment-api-token" {
		t.Errorf("PaymentAPIToken = %q, want local default", cfg.PaymentAPIToken)
	}
	if cfg.TossPaymentsSecretKey != "" || cfg.TossPlaceAccessKey != "" || cfg.TossPlaceSecretKey != "" || cfg.TossPlaceMerchantID != "" {
		t.Error("payment provider credentials must be empty by default")
	}
	if cfg.TossPaymentsAPIBaseURL != "https://api.tosspayments.com" {
		t.Errorf("TossPaymentsAPIBaseURL = %q", cfg.TossPaymentsAPIBaseURL)
	}
	if cfg.TossPlaceAPIBaseURL != "https://open-api.tossplace.com" {
		t.Errorf("TossPlaceAPIBaseURL = %q", cfg.TossPlaceAPIBaseURL)
	}
	if cfg.POSOrderProvider != "open-api" || cfg.POSPluginAPIToken != "" {
		t.Errorf("POS plugin defaults = provider %q token %q", cfg.POSOrderProvider, cfg.POSPluginAPIToken)
	}
	if cfg.YouTubeAPIKey != "" {
		t.Errorf("YouTubeAPIKey = %q, want empty default", cfg.YouTubeAPIKey)
	}
	if cfg.YouTubeAPIBaseURL != "https://www.googleapis.com/youtube/v3" {
		t.Errorf("YouTubeAPIBaseURL = %q", cfg.YouTubeAPIBaseURL)
	}
}

func TestLoad_PortEnvBuildsAddr(t *testing.T) {
	t.Setenv("APP_ADDR", "")
	t.Setenv("PORT", "4000")

	cfg := Load()

	if cfg.Addr != ":4000" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, ":4000")
	}
}

func TestLoad_AppAddrTakesPrecedenceOverPort(t *testing.T) {
	t.Setenv("APP_ADDR", ":9999")
	t.Setenv("PORT", "4000")

	cfg := Load()

	if cfg.Addr != ":9999" {
		t.Errorf("Addr = %q, want %q (APP_ADDR should win over PORT)", cfg.Addr, ":9999")
	}
}

func TestLoad_ReadsOverridesFromEnv(t *testing.T) {
	t.Setenv("APP_ADDR", ":8081")
	t.Setenv("DATABASE_URL", "postgres://user:pass@example.com:5432/db")
	t.Setenv("ALLOWED_ORIGIN", "https://example.com")
	t.Setenv("ADMIN_API_TOKEN", "custom-token")
	t.Setenv("SUPABASE_URL", "https://project-ref.supabase.co")
	t.Setenv("SUPABASE_BROADCAST_KEY", "sb_secret_example")
	t.Setenv("PAYMENT_API_TOKEN", "payment-token")
	t.Setenv("TOSS_PAYMENTS_SECRET_KEY", "live-sk")
	t.Setenv("TOSS_PAYMENTS_API_BASE_URL", "https://payments.example.com")
	t.Setenv("TOSS_PLACE_ACCESS_KEY", "place-access")
	t.Setenv("TOSS_PLACE_SECRET_KEY", "place-secret")
	t.Setenv("TOSS_PLACE_MERCHANT_ID", "merchant-123")
	t.Setenv("TOSS_PLACE_API_BASE_URL", "https://place.example.com")
	t.Setenv("POS_ORDER_PROVIDER", "plugin")
	t.Setenv("POS_PLUGIN_API_TOKEN", "plugin-token")
	t.Setenv("YOUTUBE_API_KEY", "youtube-key")
	t.Setenv("YOUTUBE_API_BASE_URL", "https://youtube.example.com/v3")

	cfg := Load()

	if cfg.Addr != ":8081" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, ":8081")
	}
	if cfg.DatabaseURL != "postgres://user:pass@example.com:5432/db" {
		t.Errorf("DatabaseURL = %q, want overridden value", cfg.DatabaseURL)
	}
	if cfg.AllowedOrigin != "https://example.com" {
		t.Errorf("AllowedOrigin = %q, want overridden value", cfg.AllowedOrigin)
	}
	if cfg.AdminAPIToken != "custom-token" {
		t.Errorf("AdminAPIToken = %q, want overridden value", cfg.AdminAPIToken)
	}
	if cfg.SupabaseURL != "https://project-ref.supabase.co" {
		t.Errorf("SupabaseURL = %q, want overridden value", cfg.SupabaseURL)
	}
	if cfg.SupabaseBroadcastKey != "sb_secret_example" {
		t.Errorf("SupabaseBroadcastKey = %q, want overridden value", cfg.SupabaseBroadcastKey)
	}
	if cfg.PaymentAPIToken != "payment-token" || cfg.TossPaymentsSecretKey != "live-sk" {
		t.Error("payment environment overrides were not loaded")
	}
	if cfg.TossPaymentsAPIBaseURL != "https://payments.example.com" {
		t.Errorf("TossPaymentsAPIBaseURL = %q", cfg.TossPaymentsAPIBaseURL)
	}
	if cfg.TossPlaceAccessKey != "place-access" || cfg.TossPlaceSecretKey != "place-secret" || cfg.TossPlaceMerchantID != "merchant-123" {
		t.Error("Toss Place environment overrides were not loaded")
	}
	if cfg.TossPlaceAPIBaseURL != "https://place.example.com" {
		t.Errorf("TossPlaceAPIBaseURL = %q", cfg.TossPlaceAPIBaseURL)
	}
	if cfg.POSOrderProvider != "plugin" || cfg.POSPluginAPIToken != "plugin-token" {
		t.Error("POS plugin environment overrides were not loaded")
	}
	if cfg.YouTubeAPIKey != "youtube-key" || cfg.YouTubeAPIBaseURL != "https://youtube.example.com/v3" {
		t.Error("YouTube environment overrides were not loaded")
	}
}
