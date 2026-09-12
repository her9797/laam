package httpapi

type createCategoryRequest struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	IsVisible bool   `json:"isVisible"`
}

type createMenuItemRequest struct {
	CategoryID  string `json:"categoryId"`
	Badge       string `json:"badge"`
	BadgeColor  string `json:"badgeColor"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Price       string `json:"price"`
	IsVisible   bool   `json:"isVisible"`
}

type createNoticeRequest struct {
	Text      string `json:"text"`
	IsVisible bool   `json:"isVisible"`
}

type updateNoticeRequest struct {
	Text string `json:"text"`
}

type createCustomerRequestRequest struct {
	TableNumber string `json:"tableNumber"`
	Text        string `json:"text"`
}

type createSpecialRequestRequest struct {
	TableNumber string `json:"tableNumber"`
	Gender      string `json:"gender"`
	Name        string `json:"name"`
	Age         string `json:"age"`
	Residence   string `json:"residence"`
	Instagram   string `json:"instagram"`
	IdealType   string `json:"idealType"`
	Text        string `json:"text"`
}

type updateVisibilityRequest struct {
	IsVisible bool `json:"isVisible"`
}

type updateMenuItemRecipeRequest struct {
	Ingredients  string `json:"ingredients"`
	Instructions string `json:"instructions"`
}

type updateCustomerRequestStatusRequest struct {
	Status string `json:"status"`
}

type updatePaymentOrderStatusRequest struct {
	Status string `json:"status"`
}

type bulkUpdateCustomerRequestStatusRequest struct {
	IDs    []string `json:"ids"`
	Status string   `json:"status"`
}

type updateStoreCopiesRequest struct {
	SongRequestCopy string `json:"songRequestCopy"`
	RequestCopy     string `json:"requestCopy"`
	EventCopy       string `json:"eventCopy"`
}
