package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/her9797/laam/laam-api/internal/catalogsync"
	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/httpapi"
	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("unable to create postgres pool: %v", err)
	}
	defer pool.Close()

	repository := store.New(pool)
	if err := repository.EnsureSchema(ctx); err != nil {
		log.Fatalf("unable to ensure schema: %v", err)
	}
	if err := repository.SeedDefaults(ctx); err != nil {
		log.Fatalf("unable to seed defaults: %v", err)
	}
	syncer := startTossCatalogSync(repository, cfg)

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.NewMux(repository, cfg, syncer),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("laam-api listening on %s", cfg.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// startTossCatalogSync creates the Syncer used by NewMux's manual
// "다시 동기화" endpoint and performs one initial sync. Catalog updates
// after startup are intentionally manual so idle API instances do not poll
// Toss Place on a fixed schedule.
func startTossCatalogSync(repository *store.Repository, cfg config.Config) *catalogsync.Syncer {
	if cfg.TossPlaceAccessKey == "" || cfg.TossPlaceSecretKey == "" || cfg.TossPlaceMerchantID == "" {
		log.Printf("catalog sync disabled: Toss Place is not configured")
		return nil
	}

	client := tossplace.NewClient(
		cfg.TossPlaceAPIBaseURL,
		cfg.TossPlaceAccessKey,
		cfg.TossPlaceSecretKey,
		cfg.TossPlaceMerchantID,
		&http.Client{Timeout: 30 * time.Second},
	)
	syncer := catalogsync.New(client, repository)
	run := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		result, err := syncer.Sync(ctx)
		if err != nil {
			log.Printf("catalog sync failed: %v", err)
			return
		}
		log.Printf("catalog sync complete: created=%d linked=%d updated=%d", result.Created, result.Linked, result.Updated)
	}

	run()

	return syncer
}
