package catalogsync

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/her9797/lam/lam-api/internal/store"
	"github.com/her9797/lam/lam-api/internal/tossplace"
)

type fakeCatalogClient struct {
	items []tossplace.CatalogItem
}

func (f fakeCatalogClient) ListCatalogItems(context.Context) ([]tossplace.CatalogItem, error) {
	return f.items, nil
}

type fakeCatalogRepository struct {
	items []store.TossCatalogItem
}

func (f *fakeCatalogRepository) SyncTossCatalog(_ context.Context, items []store.TossCatalogItem) (store.TossCatalogSyncResult, error) {
	f.items = items
	return store.TossCatalogSyncResult{Created: len(items)}, nil
}

func TestSyncMapsPOSCategoriesToCustomerCategories(t *testing.T) {
	repository := &fakeCatalogRepository{}
	syncer := New(fakeCatalogClient{items: []tossplace.CatalogItem{
		{ID: "1", Title: "얼그레이하이볼", ImageURL: "https://cdn.example.com/item.png", Category: tossplace.CatalogCategory{Title: "1%~7%"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 10000}, State: "ON_SALE", Enabled: true, Options: []tossplace.CatalogOption{{ID: "option-1", Title: "샷", Enabled: true, Choices: []tossplace.CatalogOptionChoice{{ID: "choice-1", Title: "추가", Enabled: true, State: "ON_SALE", PriceValue: 500}}}}},
		{ID: "2", Title: "제임슨", Category: tossplace.CatalogCategory{Title: "블렌디드 위스키"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 9000}, State: "ON_SALE", Enabled: true},
		{ID: "3", Title: "셜리템플", Category: tossplace.CatalogCategory{Title: "논알콜"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 0}, State: "ON_SALE", Enabled: true},
		{ID: "4", Title: "진토닉", Category: tossplace.CatalogCategory{Title: "8%~19%"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 10000}, State: "SOLD_OUT", Enabled: true},
		{ID: "5", Title: "라암 스페셜", Labels: []string{"추천", "신규"}, Category: tossplace.CatalogCategory{Title: "시그니처"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 15000}, State: "ON_SALE", Enabled: true},
	}}, repository)

	if _, err := syncer.Sync(context.Background()); err != nil {
		t.Fatalf("Sync() error = %v", err)
	}
	if got := repository.items[0].CategoryID; got != "highball" {
		t.Fatalf("highball category = %q", got)
	}
	if repository.items[0].ImageURL != "https://cdn.example.com/item.png" || len(repository.items[0].Options) != 1 || repository.items[0].Options[0].Choices[0].PriceValue != 500 {
		t.Fatalf("catalog media/options = %+v", repository.items[0])
	}
	if got := repository.items[1].CategoryID; got != "whisky" {
		t.Fatalf("whisky category = %q", got)
	}
	if got := repository.items[2].CategoryID; got != "non-alcohol" || repository.items[2].IsVisible {
		t.Fatalf("non-alcohol mapping = %+v", repository.items[2])
	}
	if got := repository.items[3].CategoryID; got != "cocktail" || repository.items[3].IsVisible {
		t.Fatalf("cocktail mapping = %+v", repository.items[3])
	}
	if got := repository.items[4].CategoryID; got != "signature" || repository.items[4].Badge != "추천" {
		t.Fatalf("signature label mapping = %+v", repository.items[4])
	}
}

// blockingCatalogClient lets a test hold ListCatalogItems open until it
// chooses to release it, so a second, concurrent Sync() call can be made
// while the first is still in flight. Only the *first* call blocks — every
// call after that returns immediately — so a test can also verify the
// Syncer is usable again once the blocked call completes.
type blockingCatalogClient struct {
	entered chan struct{}
	release chan struct{}
	blocked bool
	blockMu sync.Mutex
}

func (b *blockingCatalogClient) ListCatalogItems(context.Context) ([]tossplace.CatalogItem, error) {
	b.blockMu.Lock()
	if b.blocked {
		b.blockMu.Unlock()
		return nil, nil
	}
	b.blocked = true
	b.blockMu.Unlock()

	close(b.entered)
	<-b.release
	return nil, nil
}

func TestSync_RejectsAConcurrentCallWhileOneIsAlreadyRunning(t *testing.T) {
	client := &blockingCatalogClient{entered: make(chan struct{}), release: make(chan struct{})}
	repository := &fakeCatalogRepository{}
	syncer := New(client, repository)

	firstErr := make(chan error, 1)
	go func() {
		_, err := syncer.Sync(context.Background())
		firstErr <- err
	}()

	<-client.entered // wait for the first call to actually be in flight

	if _, err := syncer.Sync(context.Background()); !errors.Is(err, ErrSyncInProgress) {
		t.Fatalf("second, concurrent Sync() error = %v, want ErrSyncInProgress", err)
	}

	close(client.release)
	if err := <-firstErr; err != nil {
		t.Fatalf("first Sync() error = %v, want nil", err)
	}

	// The lock must be released once the first call finishes, so a later,
	// non-concurrent call succeeds normally.
	if _, err := syncer.Sync(context.Background()); err != nil {
		t.Fatalf("Sync() after the first call finished error = %v, want nil", err)
	}
}
