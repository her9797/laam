package lamdata

type StoreInfo struct {
	Name            string `json:"name"`
	Subtitle        string `json:"subtitle"`
	Address         string `json:"address"`
	SongRequestCopy string `json:"songRequestCopy"`
	RequestCopy     string `json:"requestCopy"`
	EventCopy       string `json:"eventCopy"`
}

type MenuCategory struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	IsVisible bool   `json:"isVisible"`
}

type MenuItem struct {
	ID          string          `json:"id"`
	CategoryID  string          `json:"categoryId"`
	Badge       string          `json:"badge,omitempty"`
	BadgeColor  string          `json:"badgeColor,omitempty"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Price       string          `json:"price"`
	ImageURL    string          `json:"imageUrl,omitempty"`
	IsVisible   bool            `json:"isVisible"`
	Images      []MenuImage     `json:"images,omitempty"`
	Options     []MenuOption    `json:"options,omitempty"`
	Labels      []MenuItemLabel `json:"labels,omitempty"`
}

// MenuItemLabel pairs a Toss Place catalog label (in the order Toss gives
// it) with the color an operator assigned to that position. Text always
// comes from Toss; Color is admin-set and empty until they pick one.
type MenuItemLabel struct {
	Text  string `json:"text"`
	Color string `json:"color,omitempty"`
}

type MenuOption struct {
	ID         string             `json:"id"`
	Title      string             `json:"title"`
	Required   bool               `json:"required"`
	MinChoices int                `json:"minChoices"`
	MaxChoices int                `json:"maxChoices"`
	Choices    []MenuOptionChoice `json:"choices"`
}

type MenuOptionChoice struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	PriceValue      int64  `json:"priceValue"`
	ImageURL        string `json:"imageUrl,omitempty"`
	QuantityEnabled bool   `json:"quantityEnabled"`
	MinQuantity     int64  `json:"minQuantity"`
	MaxQuantity     int64  `json:"maxQuantity"`
}

// MenuItemRecipe is the admin-only ingredients/method text for a menu item.
// It is never included in MenuItem or the public bootstrap/menu responses —
// only the dedicated admin recipe endpoint returns it.
type MenuItemRecipe struct {
	MenuItemID   string `json:"menuItemId"`
	Ingredients  string `json:"ingredients"`
	Instructions string `json:"instructions"`
}

type MenuImage struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	MimeType    string `json:"mimeType"`
	SizeBytes   int64  `json:"sizeBytes"`
	IsPrimary   bool   `json:"isPrimary"`
	DisplayArea string `json:"displayArea"`
	FocusX      int    `json:"focusX"`
	FocusY      int    `json:"focusY"`
	SortOrder   int    `json:"sortOrder"`
	ContentURL  string `json:"contentUrl"`
}

type NoticeItem struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	IsVisible bool   `json:"isVisible"`
}

type CustomerRequest struct {
	ID          string `json:"id"`
	TableNumber string `json:"tableNumber"`
	Text        string `json:"text"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	HandledAt   string `json:"handledAt,omitempty"`
}

type SongQueueItem struct {
	ID                  string `json:"id"`
	CustomerRequestID   string `json:"customerRequestId"`
	TableNumber         string `json:"tableNumber"`
	RequestText         string `json:"requestText"`
	YouTubeVideoID      string `json:"youtubeVideoId"`
	YouTubeTitle        string `json:"youtubeTitle"`
	YouTubeChannelTitle string `json:"youtubeChannelTitle"`
	Status              string `json:"status"`
	QueuedAt            string `json:"queuedAt"`
	StartedAt           string `json:"startedAt,omitempty"`
	CompletedAt         string `json:"completedAt,omitempty"`
}

type SpecialRequest struct {
	ID          string `json:"id"`
	TableNumber string `json:"tableNumber"`
	Gender      string `json:"gender"`
	Name        string `json:"name"`
	Age         string `json:"age"`
	Residence   string `json:"residence"`
	Instagram   string `json:"instagram"`
	IdealType   string `json:"idealType"`
	Text        string `json:"text"`
	CreatedAt   string `json:"createdAt"`
}

// PaymentOrder is the admin-facing read shape for a payment_orders row,
// deliberately separate from store.PaymentOrder (the customer payment-flow
// contract lam-web's services/payment-service.ts depends on) even though
// the fields largely overlap — per AGENTS.md, customer and admin contracts
// stay decoupled so the two can evolve independently.
type PaymentOrder struct {
	OrderID        string `json:"orderId"`
	MenuItemID     string `json:"menuItemId,omitempty"`
	MenuItemName   string `json:"menuItemName"`
	CategoryName   string `json:"categoryName"`
	TableNumber    string `json:"tableNumber"`
	RequestNote    string `json:"requestNote"`
	Amount         int64  `json:"amount"`
	VAT            int64  `json:"vat"`
	SuppliedAmount int64  `json:"suppliedAmount"`
	TaxFreeAmount  int64  `json:"taxFreeAmount"`
	Status         string `json:"status"`
	PaymentMethod  string `json:"paymentMethod,omitempty"`
	PaymentKey     string `json:"paymentKey,omitempty"`
	ApprovedAt     string `json:"approvedAt,omitempty"`
	POSSyncStatus  string `json:"posSyncStatus"`
	POSOrderID     string `json:"posOrderId,omitempty"`
	POSSyncError   string `json:"posSyncError,omitempty"`
	CreatedAt      string `json:"createdAt"`
}

type PaymentOrderPage struct {
	Items    []PaymentOrder `json:"items"`
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
	Total    int            `json:"total"`
}

// PaymentOrderStats is the aggregated response for the admin sales-stats
// screen (`GET /api/v1/admin/payment-orders/stats`). Every figure is
// computed over DONE orders only, within the caller-supplied [from, to)
// range — see `store.Repository.GetPaymentOrderStats`'s doc comment for the
// bucketing/timezone rules.
type PaymentOrderStatsSummary struct {
	TotalRevenue      int64 `json:"totalRevenue"`
	OrderCount        int   `json:"orderCount"`
	AverageOrderValue int64 `json:"averageOrderValue"`
}

type PaymentOrderTrendBucket struct {
	Bucket     string `json:"bucket"`
	Revenue    int64  `json:"revenue"`
	OrderCount int    `json:"orderCount"`
}

type PaymentOrderTrend struct {
	Unit    string                    `json:"unit"`
	Buckets []PaymentOrderTrendBucket `json:"buckets"`
}

type PaymentOrderCategoryStat struct {
	CategoryName string `json:"categoryName"`
	Revenue      int64  `json:"revenue"`
	OrderCount   int    `json:"orderCount"`
}

type PaymentOrderPaymentMethodStat struct {
	PaymentMethod string `json:"paymentMethod"`
	Revenue       int64  `json:"revenue"`
	OrderCount    int    `json:"orderCount"`
}

type PaymentOrderTableStat struct {
	TableNumber string `json:"tableNumber"`
	Revenue     int64  `json:"revenue"`
	OrderCount  int    `json:"orderCount"`
}

// PaymentOrderMenuItemStat is the sales-stats screen's per-product
// breakdown. Grouped by menu_item_name (a snapshot on the order row taken
// at purchase time), not menu_item_id: a deleted menu item sets its
// referencing orders' menu_item_id to NULL (ON DELETE SET NULL), but the
// name snapshot survives, so past sales stay attributable after the
// product itself is gone.
type PaymentOrderMenuItemStat struct {
	MenuItemName string `json:"menuItemName"`
	Revenue      int64  `json:"revenue"`
	OrderCount   int    `json:"orderCount"`
}

type PaymentOrderStats struct {
	Summary         PaymentOrderStatsSummary        `json:"summary"`
	Trend           PaymentOrderTrend               `json:"trend"`
	ByCategory      []PaymentOrderCategoryStat      `json:"byCategory"`
	ByPaymentMethod []PaymentOrderPaymentMethodStat `json:"byPaymentMethod"`
	ByTable         []PaymentOrderTableStat         `json:"byTable"`
	ByMenuItem      []PaymentOrderMenuItemStat      `json:"byMenuItem"`
}

type CustomerRequestPage struct {
	Items    []CustomerRequest `json:"items"`
	Page     int               `json:"page"`
	PageSize int               `json:"pageSize"`
	Total    int               `json:"total"`
}

type SpecialRequestPage struct {
	Items    []SpecialRequest `json:"items"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
	Total    int              `json:"total"`
}

// SystemErrorLog is one recorded 5xx response (from a normal writeError
// path or a recovered handler panic) — see
// store.Repository.RecordSystemErrorLog / ListSystemErrorLogs.
type SystemErrorLog struct {
	ID        string `json:"id"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Status    int    `json:"status"`
	Message   string `json:"message"`
	CreatedAt string `json:"createdAt"`
}

type SystemErrorLogPage struct {
	Items    []SystemErrorLog `json:"items"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
	Total    int              `json:"total"`
}

type BootstrapData struct {
	Store         StoreInfo      `json:"store"`
	Categories    []MenuCategory `json:"categories"`
	Items         []MenuItem     `json:"items"`
	RequestGuides []NoticeItem   `json:"requestGuides"`
	Notices       []NoticeItem   `json:"notices"`
}

type MenuData struct {
	Store      StoreInfo      `json:"store"`
	Categories []MenuCategory `json:"categories"`
	Items      []MenuItem     `json:"items"`
}

// CatalogSyncResponse is the response for
// POST /api/v1/admin/catalog-sync — the manual sync an operator triggers
// to get the latest Toss Place data without restarting the server (which
// is otherwise the only time cmd/server/main.go syncs the catalog).
// `Data` is the refreshed bootstrap snapshot (mirroring every other admin
// mutation endpoint's "return the full state" contract) so the admin web
// can update its menu list in the same round trip that reports the sync
// counts.
type CatalogSyncResponse struct {
	Created int           `json:"created"`
	Linked  int           `json:"linked"`
	Updated int           `json:"updated"`
	Data    BootstrapData `json:"data"`
}
