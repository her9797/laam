package catalogsync

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

type fakeCatalogClient struct {
	items      []tossplace.CatalogItem
	categories []tossplace.CatalogCategoryDetail
}

func (f fakeCatalogClient) ListCatalogItems(context.Context) ([]tossplace.CatalogItem, error) {
	return f.items, nil
}

func (f fakeCatalogClient) ListCatalogCategories(context.Context) ([]tossplace.CatalogCategoryDetail, error) {
	return f.categories, nil
}

type fakeCatalogRepository struct {
	items      []store.TossCatalogItem
	categories []store.TossCatalogCategory
}

func (f *fakeCatalogRepository) SyncTossCatalog(_ context.Context, categories []store.TossCatalogCategory, items []store.TossCatalogItem) (store.TossCatalogSyncResult, error) {
	f.categories = categories
	f.items = items
	return store.TossCatalogSyncResult{Created: len(items)}, nil
}

// The POS owns the category list, so a sync carries its ids, titles, order
// and enabled flag through untouched. An item goes where the POS filed it
// even when its name hints at something else: 얼그레이하이볼 below sits in
// "1%~7%", not in a 하이볼 bucket guessed from the name.
func TestSyncUsesPOSCategoriesDirectly(t *testing.T) {
	repository := &fakeCatalogRepository{}
	syncer := New(fakeCatalogClient{
		categories: []tossplace.CatalogCategoryDetail{
			{ID: "1567463", Title: "시그니처", Enabled: true, Order: 1},
			{ID: "1567288", Title: "1%~7%", Enabled: true, Order: 2},
			{ID: "1659122", Title: "인기", Enabled: false, Order: 10},
		},
		items: []tossplace.CatalogItem{
			{ID: "1", Title: "얼그레이하이볼", ImageURL: "https://cdn.example.com/item.png", Category: tossplace.CatalogCategory{ID: "1567288", Title: "1%~7%"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 10000}, State: "ON_SALE", Enabled: true, Options: []tossplace.CatalogOption{{ID: "option-1", Title: "샷", Enabled: true, Choices: []tossplace.CatalogOptionChoice{{ID: "choice-1", Title: "추가", Enabled: true, State: "ON_SALE", PriceValue: 500}}}}},
			{ID: "5", Title: "라암 스페셜", Labels: []string{"추천", "신규"}, Category: tossplace.CatalogCategory{ID: "1567463", Title: "시그니처"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 15000}, State: "ON_SALE", Enabled: true},
		},
	}, repository)

	if _, err := syncer.Sync(context.Background()); err != nil {
		t.Fatalf("Sync() error = %v", err)
	}

	if len(repository.categories) != 3 {
		t.Fatalf("categories = %+v, want 3", repository.categories)
	}
	if got := repository.categories[0]; got.ID != "1567463" || got.Label != "시그니처" || got.SortOrder != 1 || !got.IsVisible {
		t.Fatalf("categories[0] = %+v, want the POS category verbatim", got)
	}
	if got := repository.categories[2]; got.ID != "1659122" || got.SortOrder != 10 || got.IsVisible {
		t.Fatalf("categories[2] = %+v, want a hidden 인기 at order 10", got)
	}

	if got := repository.items[0].CategoryID; got != "1567288" {
		t.Fatalf("얼그레이하이볼 category = %q, want the POS category id 1567288", got)
	}
	if repository.items[0].ImageURL != "https://cdn.example.com/item.png" || len(repository.items[0].Options) != 1 || repository.items[0].Options[0].Choices[0].PriceValue != 500 {
		t.Fatalf("catalog media/options = %+v", repository.items[0])
	}
	if got := repository.items[1].CategoryID; got != "1567463" {
		t.Fatalf("라암 스페셜 category = %q, want 1567463", got)
	}
	if got := repository.items[1].Labels; len(got) != 2 || got[0] != "추천" || got[1] != "신규" {
		t.Fatalf("signature labels = %+v, want [추천 신규]", got)
	}
}

func TestSyncMovesABVFromDescriptionIntoDefaultColorLabel(t *testing.T) {
	repository := &fakeCatalogRepository{}
	syncer := New(fakeCatalogClient{items: []tossplace.CatalogItem{
		{ID: "love", Title: "사랑", Description: "사랑의 달콤함에 빠져보세요\nABV : 6%", Labels: []string{"추천"}, Category: tossplace.CatalogCategory{Title: "시그니처"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 10000}, State: "ON_SALE", Enabled: true},
		{ID: "xyz", Title: "X.Y.Z", Description: "27%", Category: tossplace.CatalogCategory{Title: "칵테일"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 10000}, State: "ON_SALE", Enabled: true},
		{ID: "whisky", Title: "제임슨", Description: "숙성된 위스키", Category: tossplace.CatalogCategory{Title: "위스키"}, Price: tossplace.CatalogPrice{Type: "FIXED", Value: 10000}, State: "ON_SALE", Enabled: true},
	}}, repository)

	if _, err := syncer.Sync(context.Background()); err != nil {
		t.Fatalf("Sync() error = %v", err)
	}
	if got := repository.items[0]; got.Description != "사랑의 달콤함에 빠져보세요" || len(got.Labels) != 2 || got.Labels[0] != "추천" || got.Labels[1] != "ABV : 6%" {
		t.Errorf("love mapping = %+v", got)
	}
	if got := repository.items[1]; got.Description != "" || len(got.Labels) != 1 || got.Labels[0] != "ABV : 27%" {
		t.Errorf("bare percent mapping = %+v", got)
	}
	if got := repository.items[2]; got.Description != "숙성된 위스키" || len(got.Labels) != 0 {
		t.Errorf("non-ABV mapping = %+v", got)
	}
}

func TestSplitCatalogDescriptionABVLeavesUnrelatedPercentLineAlone(t *testing.T) {
	description, label := splitCatalogDescriptionABV("행사 안내\n50%")
	if description != "행사 안내\n50%" || label != "" {
		t.Fatalf("splitCatalogDescriptionABV() = %q, %q; want unchanged description", description, label)
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

func (b *blockingCatalogClient) ListCatalogCategories(context.Context) ([]tossplace.CatalogCategoryDetail, error) {
	return nil, nil
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
