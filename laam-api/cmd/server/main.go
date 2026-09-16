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
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := store.NewPool(ctx, cfg.DatabaseURL, cfg.DBStatementTimeout)
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

	server := newHTTPServer(cfg.Addr, httpapi.NewMux(repository, cfg, syncer))

	log.Printf("laam-api listening on %s", cfg.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// newHTTPServer bounds each connection so slow or stalled clients cannot
// hold server resources indefinitely. ReadTimeout covers the whole request
// including an 8MB admin image upload body. WriteTimeout is counted from the
// end of the request headers, so it must exceed ReadTimeout plus the longest
// handler (the manual catalog sync runs under a 30s context).
func newHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
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
