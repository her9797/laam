package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/lamdata"
)

// fakeStorage is a minimal in-memory stand-in for the Supabase Storage REST
// API endpoints internal/objectstore calls.
type fakeStorage struct {
	mu         sync.Mutex
	objects    map[string][]byte
	failDelete bool
	server     *httptest.Server
}

func newFakeStorage(t *testing.T) *fakeStorage {
	t.Helper()
	fs := &fakeStorage{objects: map[string][]byte{}}
	fs.server = httptest.NewServer(http.HandlerFunc(fs.serve))
	t.Cleanup(fs.server.Close)
	return fs
}

func (fs *fakeStorage) serve(w http.ResponseWriter, r *http.Request) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if r.Header.Get("apikey") != "test-storage-key" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	path := r.URL.Path
	if rest, ok := strings.CutPrefix(path, "/storage/v1/object/sign/expense-receipts/"); ok && r.Method == http.MethodPost {
		if _, exists := fs.objects[rest]; !exists {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"statusCode":"404","error":"not_found","message":"Object not found"}`))
			return
		}
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/expense-receipts/` + rest + `?token=signed"}`))
		return
	}
	rest, ok := strings.CutPrefix(path, "/storage/v1/object/expense-receipts/")
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	switch r.Method {
	case http.MethodPost:
		body, _ := io.ReadAll(r.Body)
		fs.objects[rest] = body
		_, _ = w.Write([]byte(`{"Key":"expense-receipts/` + rest + `"}`))
	case http.MethodDelete:
		if fs.failDelete {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if _, exists := fs.objects[rest]; !exists {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		delete(fs.objects, rest)
		_, _ = w.Write([]byte(`{"message":"Successfully deleted"}`))
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (fs *fakeStorage) keys() []string {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	var keys []string
	for key := range fs.objects {
		keys = append(keys, key)
	}
	return keys
}

func (fs *fakeStorage) config() config.Config {
	cfg := testCfg
	cfg.SupabaseURL = fs.server.URL
	cfg.SupabaseStorageKey = "test-storage-key"
	cfg.ExpenseReceiptBucket = "expense-receipts"
	return cfg
}

func resetExpenseServer(t *testing.T, cfg config.Config) http.Handler {
	t.Helper()
	handler := resetServerWithConfig(t, cfg)
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `TRUNCATE expense_receipt_lines, expense_receipts, inventory_adjustments, inventory_items RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("truncate expense tables: %v", err)
	}
	// Dropping every category and rerunning EnsureSchema restores the seeded
	// defaults exactly.
	if _, err := testPool.Exec(ctx, `DELETE FROM expense_categories`); err != nil {
		t.Fatalf("delete categories: %v", err)
	}
	if err := testRepo.EnsureSchema(ctx); err != nil {
		t.Fatalf("ensure schema: %v", err)
	}
	return handler
}

func jsonBody(t *testing.T, value any) []byte {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return body
}

func decodeJSON[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return out
}

func expectStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, want, rec.Body.String())
	}
}

func createItemHTTP(t *testing.T, handler http.Handler, name string, quantity int) lamdata.InventoryItem {
	t.Helper()
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/inventory-items", jsonBody(t, map[string]any{
		"name": name, "categoryId": "liquor", "unit": "병", "quantity": quantity, "minQuantity": 1,
	}), adminHeaders())
	expectStatus(t, rec, http.StatusCreated)
	return decodeJSON[lamdata.InventoryItem](t, rec)
}

func createReceiptHTTP(t *testing.T, handler http.Handler, body map[string]any) lamdata.ExpenseReceipt {
	t.Helper()
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/expense-receipts", jsonBody(t, body), adminHeaders())
	expectStatus(t, rec, http.StatusCreated)
	return decodeJSON[lamdata.ExpenseReceipt](t, rec)
}

func simpleReceiptBody(date string) map[string]any {
	return map[string]any{
		"date": date, "vendor": "마트", "paymentMethod": "cash", "memo": "",
		"lines": []map[string]any{{"categoryId": "other", "description": "봉투", "amount": 500}},
	}
}

func TestExpenseRoutes_RequireAdminAuth(t *testing.T) {
	handler := resetExpenseServer(t, testCfg)
	paths := []string{
		"/api/v1/admin/expense-categories",
		"/api/v1/admin/inventory-items",
		"/api/v1/admin/inventory-items/x/adjustments",
		"/api/v1/admin/expense-receipts?month=2026-09",
		"/api/v1/admin/expense-receipts/x",
		"/api/v1/admin/expense-receipts/x/image-url",
		"/api/v1/admin/expenses/summary?month=2026-09",
		"/api/v1/admin/inventory/summary",
	}
	for _, path := range paths {
		rec := doRequest(t, handler, http.MethodGet, path, nil, map[string]string{"Authorization": "Bearer wrong"})
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s status = %d, want 401", path, rec.Code)
		}
	}
}

func TestExpenseRoutes_CategoriesCRUD(t *testing.T) {
	handler := resetExpenseServer(t, testCfg)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/expense-categories", nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	if got := decodeJSON[[]lamdata.ExpenseCategory](t, rec); len(got) != 6 || got[0].ID != "liquor" {
		t.Fatalf("categories = %+v", got)
	}

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/expense-categories", jsonBody(t, map[string]any{"name": "청소"}), adminHeaders())
	expectStatus(t, rec, http.StatusCreated)
	created := decodeJSON[lamdata.ExpenseCategory](t, rec)

	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/expense-categories/"+created.ID, jsonBody(t, map[string]any{"name": "청소 용품"}), adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	if got := decodeJSON[lamdata.ExpenseCategory](t, rec); got.Name != "청소 용품" {
		t.Fatalf("renamed = %+v", got)
	}

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/expense-categories", jsonBody(t, map[string]any{"name": ""}), adminHeaders())
	expectStatus(t, rec, http.StatusBadRequest)
	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/expense-categories/missing", jsonBody(t, map[string]any{"name": "x"}), adminHeaders())
	expectStatus(t, rec, http.StatusNotFound)
	rec = doRequest(t, handler, http.MethodDelete, "/api/v1/admin/expense-categories/liquor", nil, adminHeaders())
	expectStatus(t, rec, http.StatusMethodNotAllowed)
}

func TestExpenseRoutes_InventoryItemsAndAdjust(t *testing.T) {
	handler := resetExpenseServer(t, testCfg)
	item := createItemHTTP(t, handler, "Gin", 2)
	if item.NeedsReorder || item.Quantity != 2 || item.LastPurchasedAt != nil || item.LastUnitPrice != nil {
		t.Fatalf("item = %+v", item)
	}

	cases := []struct {
		name   string
		method string
		path   string
		body   string
		want   int
	}{
		{"duplicate name", http.MethodPost, "/api/v1/admin/inventory-items", `{"name":" gin ","categoryId":"liquor","unit":"병"}`, http.StatusConflict},
		{"negative quantity", http.MethodPost, "/api/v1/admin/inventory-items", `{"name":"Rum","categoryId":"liquor","unit":"병","quantity":-1}`, http.StatusBadRequest},
		{"fractional quantity", http.MethodPost, "/api/v1/admin/inventory-items", `{"name":"Rum","categoryId":"liquor","unit":"병","quantity":1.5}`, http.StatusBadRequest},
		{"malformed json", http.MethodPost, "/api/v1/admin/inventory-items", `{`, http.StatusBadRequest},
		{"patch quantity refused", http.MethodPatch, "/api/v1/admin/inventory-items/" + item.ID, `{"quantity":10}`, http.StatusBadRequest},
		{"patch missing", http.MethodPatch, "/api/v1/admin/inventory-items/missing", `{"unit":"잔"}`, http.StatusNotFound},
		{"adjust both", http.MethodPost, "/api/v1/admin/inventory-items/" + item.ID + "/adjust", `{"delta":1,"set":1}`, http.StatusBadRequest},
		{"adjust neither", http.MethodPost, "/api/v1/admin/inventory-items/" + item.ID + "/adjust", `{}`, http.StatusBadRequest},
		{"adjust below zero", http.MethodPost, "/api/v1/admin/inventory-items/" + item.ID + "/adjust", `{"delta":-3}`, http.StatusBadRequest},
		{"adjust missing", http.MethodPost, "/api/v1/admin/inventory-items/missing/adjust", `{"delta":1}`, http.StatusNotFound},
		{"bad limit", http.MethodGet, "/api/v1/admin/inventory-items/" + item.ID + "/adjustments?limit=abc", ``, http.StatusBadRequest},
		{"bad includeArchived", http.MethodGet, "/api/v1/admin/inventory-items?includeArchived=maybe", ``, http.StatusBadRequest},
	}
	for _, tc := range cases {
		var body []byte
		if tc.body != "" {
			body = []byte(tc.body)
		}
		rec := doRequest(t, handler, tc.method, tc.path, body, adminHeaders())
		if rec.Code != tc.want {
			t.Errorf("%s: status = %d, want %d, body = %s", tc.name, rec.Code, tc.want, rec.Body.String())
		}
	}

	rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/inventory-items/"+item.ID, []byte(`{"name":"Gin Tanqueray","minQuantity":5}`), adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	patched := decodeJSON[lamdata.InventoryItem](t, rec)
	if patched.Name != "Gin Tanqueray" || patched.MinQuantity != 5 || patched.Quantity != 2 || patched.Unit != "병" || !patched.NeedsReorder {
		t.Fatalf("patched = %+v", patched)
	}

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/inventory-items/"+item.ID+"/adjust", []byte(`{"set":6}`), adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	if got := decodeJSON[lamdata.InventoryItem](t, rec); got.Quantity != 6 || got.NeedsReorder {
		t.Fatalf("adjusted = %+v", got)
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/inventory-items/"+item.ID+"/adjustments?limit=500", nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	history := decodeJSON[[]lamdata.InventoryAdjustment](t, rec)
	if len(history) != 1 || history[0].Reason != "manual" || history[0].Delta != 4 {
		t.Fatalf("history = %+v", history)
	}
	if !strings.Contains(rec.Body.String(), `"receiptId":null`) {
		t.Fatalf("receiptId must serialize as null: %s", rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/inventory/summary", nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	if got := decodeJSON[lamdata.InventorySummary](t, rec); got.ReorderCount != 0 || got.NeedsCheckCount != 0 {
		t.Fatalf("summary = %+v", got)
	}
}

func TestExpenseRoutes_ReceiptLifecycleAndValidation(t *testing.T) {
	handler := resetExpenseServer(t, testCfg)
	item := createItemHTTP(t, handler, "Gin", 0)

	receipt := createReceiptHTTP(t, handler, map[string]any{
		"date": "2026-09-30", "vendor": "주류상", "paymentMethod": "card", "memo": "월말",
		"lines": []map[string]any{
			{"itemId": item.ID, "quantity": 2, "amount": 40001},
			{"categoryId": "supplies", "description": "냅킨", "amount": 3000},
		},
	})
	if receipt.Total != 43001 || len(receipt.Lines) != 2 || receipt.Lines[0].CategoryID != "liquor" {
		t.Fatalf("receipt = %+v", receipt)
	}

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/inventory-items", nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	items := decodeJSON[[]lamdata.InventoryItem](t, rec)
	if len(items) != 1 || items[0].Quantity != 2 || items[0].LastUnitPrice == nil || *items[0].LastUnitPrice != 20001 ||
		items[0].LastPurchasedAt == nil || *items[0].LastPurchasedAt != receipt.CreatedAt {
		t.Fatalf("items = %+v", items)
	}
	if strings.Contains(rec.Body.String(), `"lastPurchasedAt":null`) {
		t.Fatalf("lastPurchasedAt serialized as null after purchase: %s", rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/expense-receipts?month=2026-09&categoryId=supplies", nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	if got := decodeJSON[[]lamdata.ExpenseReceipt](t, rec); len(got) != 1 || got[0].ID != receipt.ID {
		t.Fatalf("september list = %+v", got)
	}
	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/expense-receipts?month=2026-10", nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("october list = %s, want []", rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/expense-receipts/"+receipt.ID, jsonBody(t, map[string]any{
		"date": "2026-09-30", "vendor": "주류상", "paymentMethod": "card", "memo": "",
		"lines": []map[string]any{{"categoryId": "other", "description": "대체", "amount": 100}},
	}), adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	if got := decodeJSON[lamdata.ExpenseReceipt](t, rec); got.Total != 100 || len(got.Lines) != 1 {
		t.Fatalf("patched = %+v", got)
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/expenses/summary?month=2026-09", nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	summary := decodeJSON[lamdata.ExpenseSummary](t, rec)
	if summary.Total != 100 || summary.ReceiptCount != 1 || len(summary.ByCategory) != 1 || summary.ByCategory[0].CategoryID != "other" {
		t.Fatalf("summary = %+v", summary)
	}

	validation := []struct {
		name   string
		method string
		path   string
		body   string
		want   int
	}{
		{"list without month", http.MethodGet, "/api/v1/admin/expense-receipts", "", http.StatusBadRequest},
		{"list bad month", http.MethodGet, "/api/v1/admin/expense-receipts?month=2026-9", "", http.StatusBadRequest},
		{"summary bad month", http.MethodGet, "/api/v1/admin/expenses/summary?month=x", "", http.StatusBadRequest},
		{"no lines", http.MethodPost, "/api/v1/admin/expense-receipts", `{"date":"2026-09-01","paymentMethod":"card","lines":[]}`, http.StatusBadRequest},
		{"missing amount", http.MethodPost, "/api/v1/admin/expense-receipts", `{"date":"2026-09-01","paymentMethod":"card","lines":[{"categoryId":"other","description":"x"}]}`, http.StatusBadRequest},
		{"bad payment", http.MethodPost, "/api/v1/admin/expense-receipts", `{"date":"2026-09-01","paymentMethod":"gift","lines":[{"categoryId":"other","description":"x","amount":1}]}`, http.StatusBadRequest},
		{"item qty zero", http.MethodPost, "/api/v1/admin/expense-receipts", `{"date":"2026-09-01","paymentMethod":"card","lines":[{"itemId":"` + item.ID + `","quantity":0,"amount":1}]}`, http.StatusBadRequest},
		{"get missing", http.MethodGet, "/api/v1/admin/expense-receipts/missing", "", http.StatusNotFound},
		{"patch missing", http.MethodPatch, "/api/v1/admin/expense-receipts/missing", `{"date":"2026-09-01","paymentMethod":"card","lines":[{"categoryId":"other","description":"x","amount":1}]}`, http.StatusNotFound},
		{"delete missing", http.MethodDelete, "/api/v1/admin/expense-receipts/missing", "", http.StatusNotFound},
	}
	for _, tc := range validation {
		var body []byte
		if tc.body != "" {
			body = []byte(tc.body)
		}
		rec := doRequest(t, handler, tc.method, tc.path, body, adminHeaders())
		if rec.Code != tc.want {
			t.Errorf("%s: status = %d, want %d, body = %s", tc.name, rec.Code, tc.want, rec.Body.String())
		}
		if rec.Code >= 400 && !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s: body %s lacks error field", tc.name, rec.Body.String())
		}
	}

	oversized := `{"date":"2026-09-01","paymentMethod":"card","memo":"` + strings.Repeat("a", 2<<20) + `","lines":[]}`
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/expense-receipts", []byte(oversized), adminHeaders())
	expectStatus(t, rec, http.StatusRequestEntityTooLarge)

	rec = doRequest(t, handler, http.MethodDelete, "/api/v1/admin/expense-receipts/"+receipt.ID, nil, adminHeaders())
	expectStatus(t, rec, http.StatusNoContent)
	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/inventory-items/"+item.ID+"/adjustments", nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	if history := decodeJSON[[]lamdata.InventoryAdjustment](t, rec); len(history) != 2 || history[0].Reason != "receipt_edit" {
		t.Fatalf("history = %+v", history)
	}
}

func multipartImage(t *testing.T, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("image", "../../영수증 원본.png")
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return &buf, writer.FormDataContentType()
}

func postReceiptImage(t *testing.T, handler http.Handler, receiptID string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	body, contentType := multipartImage(t, content)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/expense-receipts/"+receiptID+"/image", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+testCfg.AdminAPIToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestExpenseRoutes_ImageEndpointsUnavailableWithoutStorageKey(t *testing.T) {
	cfg := testCfg
	cfg.SupabaseURL = "https://example.supabase.co"
	cfg.ExpenseReceiptBucket = "expense-receipts"
	handler := resetExpenseServer(t, cfg)
	receipt := createReceiptHTTP(t, handler, simpleReceiptBody("2026-09-01"))

	expectStatus(t, postReceiptImage(t, handler, receipt.ID, pngOfSize(64)), http.StatusServiceUnavailable)
	expectStatus(t, doRequest(t, handler, http.MethodDelete, "/api/v1/admin/expense-receipts/"+receipt.ID+"/image", nil, adminHeaders()), http.StatusServiceUnavailable)
	expectStatus(t, doRequest(t, handler, http.MethodGet, "/api/v1/admin/expense-receipts/"+receipt.ID+"/image-url", nil, adminHeaders()), http.StatusServiceUnavailable)

	// Receipts themselves keep working without storage.
	expectStatus(t, doRequest(t, handler, http.MethodDelete, "/api/v1/admin/expense-receipts/"+receipt.ID, nil, adminHeaders()), http.StatusNoContent)
}

func TestExpenseRoutes_ImageUploadLimitsAndTypes(t *testing.T) {
	storage := newFakeStorage(t)
	handler := resetExpenseServer(t, storage.config())
	receipt := createReceiptHTTP(t, handler, simpleReceiptBody("2026-09-01"))

	expectStatus(t, postReceiptImage(t, handler, receipt.ID, pngOfSize(5<<20+1)), http.StatusRequestEntityTooLarge)
	expectStatus(t, postReceiptImage(t, handler, receipt.ID, pngOfSize(7<<20)), http.StatusRequestEntityTooLarge)
	expectStatus(t, postReceiptImage(t, handler, receipt.ID, []byte("GIF89a\x01\x00\x01\x00")), http.StatusUnsupportedMediaType)
	expectStatus(t, postReceiptImage(t, handler, receipt.ID, []byte("<html></html>")), http.StatusUnsupportedMediaType)
	expectStatus(t, postReceiptImage(t, handler, "missing", pngOfSize(64)), http.StatusNotFound)
	if keys := storage.keys(); len(keys) != 0 {
		t.Fatalf("storage objects after rejected uploads = %v", keys)
	}

	rec := postReceiptImage(t, handler, receipt.ID, pngOfSize(5<<20))
	expectStatus(t, rec, http.StatusOK)
	if got := decodeJSON[lamdata.ExpenseReceipt](t, rec); !got.HasImage || got.ID != receipt.ID {
		t.Fatalf("upload response = %+v", got)
	}
}

func TestExpenseRoutes_ImageUploadReplaceSignDelete(t *testing.T) {
	storage := newFakeStorage(t)
	handler := resetExpenseServer(t, storage.config())
	receipt := createReceiptHTTP(t, handler, simpleReceiptBody("2026-09-01"))

	expectStatus(t, doRequest(t, handler, http.MethodGet, "/api/v1/admin/expense-receipts/"+receipt.ID+"/image-url", nil, adminHeaders()), http.StatusNotFound)

	expectStatus(t, postReceiptImage(t, handler, receipt.ID, pngOfSize(64)), http.StatusOK)
	keys := storage.keys()
	if len(keys) != 1 || !strings.HasPrefix(keys[0], "receipts/"+receipt.ID+"/") || !strings.HasSuffix(keys[0], ".png") || strings.Contains(keys[0], "원본") {
		t.Fatalf("object keys = %v", keys)
	}
	firstKey := keys[0]

	jpeg := append([]byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00"), make([]byte, 64)...)
	expectStatus(t, postReceiptImage(t, handler, receipt.ID, jpeg), http.StatusOK)
	keys = storage.keys()
	if len(keys) != 1 || keys[0] == firstKey || !strings.HasSuffix(keys[0], ".jpg") {
		t.Fatalf("object keys after replace = %v (first %s)", keys, firstKey)
	}

	before := time.Now().UTC()
	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/expense-receipts/"+receipt.ID+"/image-url", nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	signed := decodeJSON[lamdata.ExpenseReceiptImageURL](t, rec)
	if signed.URL != storage.server.URL+"/storage/v1/object/sign/expense-receipts/"+keys[0]+"?token=signed" {
		t.Fatalf("url = %q", signed.URL)
	}
	expiresAt, err := time.Parse(time.RFC3339, signed.ExpiresAt)
	if err != nil || expiresAt.Sub(before) < 4*time.Minute || expiresAt.Sub(before) > 6*time.Minute {
		t.Fatalf("expiresAt = %q (%v)", signed.ExpiresAt, err)
	}

	expectStatus(t, doRequest(t, handler, http.MethodDelete, "/api/v1/admin/expense-receipts/"+receipt.ID+"/image", nil, adminHeaders()), http.StatusNoContent)
	if keys := storage.keys(); len(keys) != 0 {
		t.Fatalf("object keys after image delete = %v", keys)
	}
	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/expense-receipts/"+receipt.ID, nil, adminHeaders())
	expectStatus(t, rec, http.StatusOK)
	if got := decodeJSON[lamdata.ExpenseReceipt](t, rec); got.HasImage {
		t.Fatalf("hasImage still true: %+v", got)
	}
}

func TestExpenseRoutes_DeleteReceiptRemovesImageBestEffort(t *testing.T) {
	storage := newFakeStorage(t)
	handler := resetExpenseServer(t, storage.config())

	receipt := createReceiptHTTP(t, handler, simpleReceiptBody("2026-09-01"))
	expectStatus(t, postReceiptImage(t, handler, receipt.ID, pngOfSize(64)), http.StatusOK)
	expectStatus(t, doRequest(t, handler, http.MethodDelete, "/api/v1/admin/expense-receipts/"+receipt.ID, nil, adminHeaders()), http.StatusNoContent)
	if keys := storage.keys(); len(keys) != 0 {
		t.Fatalf("object keys after receipt delete = %v", keys)
	}

	failing := createReceiptHTTP(t, handler, simpleReceiptBody("2026-09-02"))
	expectStatus(t, postReceiptImage(t, handler, failing.ID, pngOfSize(64)), http.StatusOK)
	storage.mu.Lock()
	storage.failDelete = true
	storage.mu.Unlock()
	expectStatus(t, doRequest(t, handler, http.MethodDelete, "/api/v1/admin/expense-receipts/"+failing.ID, nil, adminHeaders()), http.StatusNoContent)
	expectStatus(t, doRequest(t, handler, http.MethodGet, "/api/v1/admin/expense-receipts/"+failing.ID, nil, adminHeaders()), http.StatusNotFound)
}
