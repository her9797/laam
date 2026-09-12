package catalogsync

import (
	"context"
	"errors"
	"strings"
	"sync"

	"github.com/her9797/lam/lam-api/internal/store"
	"github.com/her9797/lam/lam-api/internal/tossplace"
)

// ErrSyncInProgress is returned by Sync when another call is already in
// flight on the same Syncer — the admin web's manual "다시 동기화" button
// and the 5-minute background ticker share one Syncer instance
// (cmd/server/main.go), so this also prevents an operator's button click
// from overlapping the scheduled poll, not just two button clicks.
var ErrSyncInProgress = errors.New("catalog sync already in progress")

type catalogClient interface {
	ListCatalogItems(context.Context) ([]tossplace.CatalogItem, error)
}

type catalogRepository interface {
	SyncTossCatalog(context.Context, []store.TossCatalogItem) (store.TossCatalogSyncResult, error)
}

type Syncer struct {
	client     catalogClient
	repository catalogRepository
	mu         sync.Mutex
}

func New(client catalogClient, repository catalogRepository) *Syncer {
	return &Syncer{client: client, repository: repository}
}

func (s *Syncer) Sync(ctx context.Context) (store.TossCatalogSyncResult, error) {
	if !s.mu.TryLock() {
		return store.TossCatalogSyncResult{}, ErrSyncInProgress
	}
	defer s.mu.Unlock()

	items, err := s.client.ListCatalogItems(ctx)
	if err != nil {
		return store.TossCatalogSyncResult{}, err
	}

	mapped := make([]store.TossCatalogItem, 0, len(items))
	for _, item := range items {
		options := make([]store.TossCatalogOption, 0, len(item.Options))
		for _, option := range item.Options {
			choices := make([]store.TossCatalogOptionChoice, 0, len(option.Choices))
			for _, choice := range option.Choices {
				choices = append(choices, store.TossCatalogOptionChoice{
					ID: choice.ID, Title: choice.Title, PriceValue: choice.PriceValue,
					ImageURL: choice.ImageURL, Enabled: choice.Enabled, State: choice.State,
					SortOrder: choice.Order, QuantityEnabled: choice.QuantityEnabled,
					MinQuantity: choice.MinQuantity, MaxQuantity: choice.MaxQuantity,
				})
			}
			options = append(options, store.TossCatalogOption{
				ID: option.ID, Title: option.Title, Enabled: option.Enabled,
				SortOrder: option.Order, Required: option.Required,
				MinChoices: option.MinChoices, MaxChoices: option.MaxChoices, Choices: choices,
			})
		}
		mapped = append(mapped, store.TossCatalogItem{
			ID:          item.ID,
			Name:        item.Title,
			Description: item.Description,
			ImageURL:    item.ImageURL,
			Badge:       firstCatalogLabel(item.Labels),
			CategoryID:  customerCategoryID(item),
			Price:       item.Price.Value,
			IsVisible:   item.Enabled && item.State == "ON_SALE" && item.Price.Type == "FIXED" && item.Price.Value > 0,
			SortOrder:   item.Order,
			Options:     options,
		})
	}

	return s.repository.SyncTossCatalog(ctx, mapped)
}

func customerCategoryID(item tossplace.CatalogItem) string {
	category := strings.TrimSpace(item.Category.Title)
	switch {
	case strings.Contains(category, "시그니처"), strings.Contains(strings.ToLower(category), "signature"):
		return "signature"
	case strings.Contains(category, "위스키"):
		return "whisky"
	case strings.Contains(category, "논알콜"):
		return "non-alcohol"
	case strings.Contains(item.Title, "하이볼"):
		return "highball"
	default:
		return "cocktail"
	}
}

func firstCatalogLabel(labels []string) string {
	for _, label := range labels {
		if trimmed := strings.TrimSpace(label); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
