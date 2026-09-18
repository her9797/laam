package httpapi

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func doRequest(t *testing.T, handler http.Handler, method, path string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()

	var reader *bytes.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	} else {
		reader = bytes.NewReader(nil)
	}

	req := httptest.NewRequest(method, path, reader)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func adminHeaders() map[string]string {
	return map[string]string{"Authorization": "Bearer " + testCfg.AdminAPIToken}
}

func TestRouter_Health(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/health", nil, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("status field = %q, want %q", body["status"], "ok")
	}
}

func TestRouter_Bootstrap(t *testing.T) {
	handler := resetServer(t)

	t.Run("GET returns 200", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/bootstrap", nil, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
	})

	t.Run("POST is not allowed", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/bootstrap", nil, nil)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("OPTIONS preflight returns 204 with CORS headers", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodOptions, "/api/v1/bootstrap", nil, nil)
		if rec.Code != http.StatusNoContent {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, "*")
		}
	})
}

func TestRouter_CustomerRequests_CreateAndAdminFlow(t *testing.T) {
	handler := resetServer(t)

	t.Run("authenticated create requires valid payload", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"tableNumber": "", "text": "help"})
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/customer-requests", body, requestHeaders())
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
		}
	})

	body, _ := json.Marshal(map[string]string{"tableNumber": "T-01", "text": "napkins please"})
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/customer-requests", body, requestHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	t.Run("admin list requires auth", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests", nil, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var requests []struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &requests); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(requests) != 1 || requests[0].Status != "pending" {
		t.Fatalf("requests = %+v, want a single pending request", requests)
	}
	requestID := requests[0].ID

	t.Run("status update via /status suffix", func(t *testing.T) {
		statusBody, _ := json.Marshal(map[string]string{"status": "completed"})
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/customer-requests/"+requestID+"/status", statusBody, adminHeaders())
		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusNoContent, rec.Body.String())
		}
		if rec.Body.Len() != 0 {
			t.Errorf("body = %q, want empty", rec.Body.String())
		}

		rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests", nil, adminHeaders())
		var updated []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if len(updated) != 1 || updated[0].Status != "completed" {
			t.Errorf("updated requests = %+v, want status=completed", updated)
		}
	})

	t.Run("PATCH without /status suffix is not found", func(t *testing.T) {
		statusBody, _ := json.Marshal(map[string]string{"status": "completed"})
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/customer-requests/"+requestID, statusBody, adminHeaders())
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
		}
	})

	t.Run("delete", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodDelete, "/api/v1/admin/customer-requests/"+requestID, nil, adminHeaders())
		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusNoContent, rec.Body.String())
		}
		if rec.Body.Len() != 0 {
			t.Errorf("body = %q, want empty", rec.Body.String())
		}
	})
}

func TestRouter_CustomerRequests_BulkStatusUpdate(t *testing.T) {
	handler := resetServer(t)

	for _, table := range []string{"T-01", "T-02"} {
		body, _ := json.Marshal(map[string]string{"tableNumber": table, "text": "help"})
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/customer-requests", body, requestHeaders())
		if rec.Code != http.StatusCreated {
			t.Fatalf("create status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
		}
	}

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var requests []struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &requests); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(requests) != 2 {
		t.Fatalf("requests = %+v, want 2 pending requests", requests)
	}
	firstID, secondID := requests[0].ID, requests[1].ID

	t.Run("requires auth", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{"ids": []string{firstID}, "status": "checked"})
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/customer-requests", body, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("empty ids is a bad request", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{"ids": []string{}, "status": "checked"})
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/customer-requests", body, adminHeaders())
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
		}
	})

	t.Run("bulk update ignores an unknown id and returns no content", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{"ids": []string{firstID, secondID, "missing"}, "status": "checked"})
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/customer-requests", body, adminHeaders())
		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusNoContent, rec.Body.String())
		}
		if rec.Body.Len() != 0 {
			t.Errorf("body = %q, want empty", rec.Body.String())
		}

		rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests", nil, adminHeaders())
		var updated []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if len(updated) != 2 {
			t.Fatalf("updated = %+v, want 2 requests", updated)
		}
		for _, item := range updated {
			if item.Status != "checked" {
				t.Errorf("item %+v, want status=checked", item)
			}
		}
	})

	t.Run("GET on the collection path still works", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests", nil, adminHeaders())
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
	})
}

// TestRouter_CustomerRequests_SendsBroadcastOnCreate exercises the router
// directly wired to a fake Supabase broadcast endpoint (config.Config
// pointed at an httptest.Server), independent of resetServer's shared
// testCfg (which leaves Supabase unconfigured on purpose, so every other
// integration test exercises the "disabled" no-op path).
func TestRouter_CustomerRequests_SendsBroadcastOnCreate(t *testing.T) {
	resetServer(t) // truncates tables; its returned handler isn't used here

	received := make(chan string, 1)
	broadcastServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received <- r.URL.Path
		w.WriteHeader(http.StatusAccepted)
	}))
	defer broadcastServer.Close()

	cfg := testCfg
	cfg.SupabaseURL = broadcastServer.URL
	cfg.SupabaseBroadcastKey = "test-broadcast-key"
	handler := NewMux(testRepo, cfg, nil)

	t.Run("general request creation sends a broadcast", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"tableNumber": "T-01", "text": "napkins"})
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/customer-requests", body, requestHeaders())
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
		}

		select {
		case path := <-received:
			if path != "/realtime/v1/api/broadcast/admin-requests/events/new_request" {
				t.Errorf("broadcast path = %q, want the admin-requests/new_request path", path)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for the broadcast send")
		}
	})

	t.Run("special request creation does not send a broadcast", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{
			"tableNumber": "T-02", "gender": "female", "name": "n", "age": "20",
			"residence": "r", "instagram": "i",
			"idealHeight": "170", "idealResidence": "r2", "idealAgeRange": "20s", "idealDetails": "t",
			"text": "hello",
		})
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/special-requests", body, requestHeaders())
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
		}

		select {
		case path := <-received:
			t.Fatalf("unexpected broadcast for a special request: %q", path)
		case <-time.After(200 * time.Millisecond):
			// expected: no broadcast for special requests
		}
	})
}

func TestRouter_SecretCoupons_Claim(t *testing.T) {
	handler := resetServer(t)

	t.Run("without auth is rejected", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"tableNumber": "T-01"})
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/secret-coupons/vinyl-laam/claim", body, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	body, _ := json.Marshal(map[string]string{"tableNumber": "T-01"})
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/secret-coupons/vinyl-laam/claim", body, requestHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	var claim struct {
		RewardLabel  string `json:"rewardLabel"`
		ClaimedCount int    `json:"claimedCount"`
		TotalCount   int    `json:"totalCount"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &claim); err != nil {
		t.Fatalf("decode claim response: %v", err)
	}
	if claim.RewardLabel != "1만원 할인권" || claim.ClaimedCount != 1 || claim.TotalCount != 5 {
		t.Fatalf("claim = %+v, want RewardLabel=1만원 할인권 ClaimedCount=1 TotalCount=5", claim)
	}

	t.Run("claiming the same coupon again is rejected", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/secret-coupons/vinyl-laam/claim", body, requestHeaders())
		if rec.Code != http.StatusConflict {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusConflict, rec.Body.String())
		}
	})

	t.Run("unknown id is not found", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/secret-coupons/does-not-exist/claim", body, requestHeaders())
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
		}
	})
}

func TestRouter_SpecialRequests_Create(t *testing.T) {
	handler := resetServer(t)

	valid := map[string]string{
		"tableNumber":    "T-01",
		"gender":         "female",
		"name":           "Lee",
		"age":            "30s",
		"residence":      "Seoul",
		"instagram":      "@lee",
		"idealHeight":    "180",
		"idealResidence": "Gangnam",
		"idealAgeRange":  "30s",
		"idealDetails":   "kind",
		"text":           "hi",
	}
	body, _ := json.Marshal(valid)
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/special-requests", body, requestHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	t.Run("invalid gender is rejected", func(t *testing.T) {
		invalid := map[string]string{}
		for k, v := range valid {
			invalid[k] = v
		}
		invalid["gender"] = "unspecified"
		body, _ := json.Marshal(invalid)
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/special-requests", body, requestHeaders())
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
		}
	})

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/special-requests", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestRouter_AdminCategories_CreateRequiresAuth(t *testing.T) {
	handler := resetServer(t)

	body, _ := json.Marshal(map[string]any{"id": "drinks", "label": "Drinks", "isVisible": true})

	t.Run("without auth is rejected", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/categories", body, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/categories", body, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
}

func TestRouter_AdminMenuItems_CreateUpdateDelete(t *testing.T) {
	handler := resetServer(t)

	catBody, _ := json.Marshal(map[string]any{"id": "food", "label": "Food", "isVisible": true})
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/categories", catBody, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("create category status = %d, body = %s", rec.Code, rec.Body.String())
	}

	itemBody, _ := json.Marshal(map[string]any{
		"categoryId": "food", "name": "Fries", "description": "crispy", "price": "5000", "isVisible": true,
	})
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/menu-items", itemBody, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("create menu item status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var bootstrap struct {
		Items []struct {
			ID        string `json:"id"`
			IsVisible bool   `json:"isVisible"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &bootstrap); err != nil {
		t.Fatalf("decode bootstrap: %v", err)
	}
	if len(bootstrap.Items) != 1 {
		t.Fatalf("items = %+v, want a single item", bootstrap.Items)
	}
	itemID := bootstrap.Items[0].ID

	t.Run("visibility PATCH", func(t *testing.T) {
		visBody, _ := json.Marshal(map[string]bool{"isVisible": false})
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/menu-items/"+itemID+"/visibility", visBody, adminHeaders())
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
		}
	})

	t.Run("label-colors PATCH", func(t *testing.T) {
		if _, err := testPool.Exec(t.Context(), `UPDATE menu_items SET toss_labels = $2 WHERE id = $1`, itemID, []string{"추천", "인기"}); err != nil {
			t.Fatalf("seed toss_labels: %v", err)
		}

		t.Run("without auth is rejected", func(t *testing.T) {
			body, _ := json.Marshal(map[string]any{"colors": []string{"green"}})
			rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/menu-items/"+itemID+"/label-colors", body, nil)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})

		body, _ := json.Marshal(map[string]any{"colors": []string{"green", "amber"}})
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/menu-items/"+itemID+"/label-colors", body, adminHeaders())
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
		}

		var updated struct {
			Items []struct {
				ID     string `json:"id"`
				Labels []struct {
					Text  string `json:"text"`
					Color string `json:"color"`
				} `json:"labels"`
			} `json:"items"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
			t.Fatalf("decode bootstrap: %v", err)
		}
		if len(updated.Items) != 1 || len(updated.Items[0].Labels) != 2 ||
			updated.Items[0].Labels[0].Text != "추천" || updated.Items[0].Labels[0].Color != "green" ||
			updated.Items[0].Labels[1].Text != "인기" || updated.Items[0].Labels[1].Color != "amber" {
			t.Fatalf("labels after color update = %+v", updated.Items[0].Labels)
		}

		t.Run("unknown id is not found", func(t *testing.T) {
			rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/menu-items/missing/label-colors", body, adminHeaders())
			if rec.Code != http.StatusNotFound {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
			}
		})
	})

	t.Run("DELETE", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodDelete, "/api/v1/admin/menu-items/"+itemID, nil, adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
	})
}

func TestRouter_AdminMenuItemRecipe_GetAndUpdate(t *testing.T) {
	handler := resetServer(t)

	catBody, _ := json.Marshal(map[string]any{"id": "food", "label": "Food", "isVisible": true})
	doRequest(t, handler, http.MethodPost, "/api/v1/admin/categories", catBody, adminHeaders())

	itemBody, _ := json.Marshal(map[string]any{
		"categoryId": "food", "name": "Fries", "description": "crispy", "price": "5000", "isVisible": true,
	})
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/menu-items", itemBody, adminHeaders())
	var bootstrap struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &bootstrap); err != nil {
		t.Fatalf("decode bootstrap: %v", err)
	}
	itemID := bootstrap.Items[0].ID

	t.Run("GET without auth is rejected", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/menu-items/"+itemID+"/recipe", nil, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("PATCH without auth is rejected", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"ingredients": "a", "instructions": "b"})
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/menu-items/"+itemID+"/recipe", body, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("GET returns empty recipe for a new item", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/menu-items/"+itemID+"/recipe", nil, adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
		var recipe struct {
			MenuItemID   string `json:"menuItemId"`
			Ingredients  string `json:"ingredients"`
			Instructions string `json:"instructions"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &recipe); err != nil {
			t.Fatalf("decode recipe: %v", err)
		}
		if recipe.MenuItemID != itemID || recipe.Ingredients != "" || recipe.Instructions != "" {
			t.Errorf("recipe = %+v, want empty ingredients/instructions for %q", recipe, itemID)
		}
	})

	t.Run("PATCH then GET reflects the update", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"ingredients": "감자 200g", "instructions": "180도에서 5분"})
		patchRec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/menu-items/"+itemID+"/recipe", body, adminHeaders())
		if patchRec.Code != http.StatusOK {
			t.Fatalf("PATCH status = %d, want %d, body = %s", patchRec.Code, http.StatusOK, patchRec.Body.String())
		}

		getRec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/menu-items/"+itemID+"/recipe", nil, adminHeaders())
		var recipe struct {
			Ingredients  string `json:"ingredients"`
			Instructions string `json:"instructions"`
		}
		if err := json.Unmarshal(getRec.Body.Bytes(), &recipe); err != nil {
			t.Fatalf("decode recipe: %v", err)
		}
		if recipe.Ingredients != "감자 200g" || recipe.Instructions != "180도에서 5분" {
			t.Errorf("recipe = %+v, want the updated ingredients/instructions", recipe)
		}
	})

	t.Run("unknown item id is not found", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/menu-items/missing/recipe", nil, adminHeaders())
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET status = %d, want %d", rec.Code, http.StatusNotFound)
		}

		body, _ := json.Marshal(map[string]string{"ingredients": "a", "instructions": "b"})
		patchRec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/menu-items/missing/recipe", body, adminHeaders())
		if patchRec.Code != http.StatusNotFound {
			t.Errorf("PATCH status = %d, want %d", patchRec.Code, http.StatusNotFound)
		}
	})

	t.Run("public bootstrap never includes recipe fields", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"ingredients": "감자 200g", "instructions": "180도에서 5분"})
		doRequest(t, handler, http.MethodPatch, "/api/v1/admin/menu-items/"+itemID+"/recipe", body, adminHeaders())

		rec := doRequest(t, handler, http.MethodGet, "/api/v1/bootstrap", nil, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("bootstrap status = %d, want %d", rec.Code, http.StatusOK)
		}
		respBody := rec.Body.String()
		if strings.Contains(respBody, "ingredients") || strings.Contains(respBody, "recipe") {
			t.Errorf("bootstrap response leaks recipe fields: %s", respBody)
		}
	})
}

func TestRouter_MenuImageUploadAndPublicContent(t *testing.T) {
	handler := resetServer(t)

	catBody, _ := json.Marshal(map[string]any{"id": "food", "label": "Food", "isVisible": true})
	doRequest(t, handler, http.MethodPost, "/api/v1/admin/categories", catBody, adminHeaders())

	itemBody, _ := json.Marshal(map[string]any{
		"categoryId": "food", "name": "Fries", "description": "crispy", "price": "5000", "isVisible": true,
	})
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/menu-items", itemBody, adminHeaders())
	var bootstrap struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &bootstrap); err != nil {
		t.Fatalf("decode bootstrap: %v", err)
	}
	itemID := bootstrap.Items[0].ID

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("image", "fries.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	// The upload handler sniffs the bytes, so the fixture needs a real PNG
	// signature in front of its placeholder payload.
	imageBytes := string(pngSignature) + "fake-png-bytes"
	if _, err := part.Write([]byte(imageBytes)); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	_ = writer.WriteField("isPrimary", "true")
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/menu-items/"+itemID+"/images", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+testCfg.AdminAPIToken)
	uploadRec := httptest.NewRecorder()
	handler.ServeHTTP(uploadRec, req)

	if uploadRec.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, want %d, body = %s", uploadRec.Code, http.StatusCreated, uploadRec.Body.String())
	}

	var uploaded struct {
		Items []struct {
			Images []struct {
				ID         string `json:"id"`
				ContentURL string `json:"contentUrl"`
				IsPrimary  bool   `json:"isPrimary"`
			} `json:"images"`
		} `json:"items"`
	}
	if err := json.Unmarshal(uploadRec.Body.Bytes(), &uploaded); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}
	if len(uploaded.Items) != 1 || len(uploaded.Items[0].Images) != 1 {
		t.Fatalf("uploaded = %+v, want a single image", uploaded)
	}
	image := uploaded.Items[0].Images[0]
	if !image.IsPrimary {
		t.Errorf("uploaded image IsPrimary = false, want true")
	}

	contentRec := doRequest(t, handler, http.MethodGet, "/api/v1/menu-images/"+image.ID+"/content", nil, nil)
	if contentRec.Code != http.StatusOK {
		t.Fatalf("content status = %d, want %d", contentRec.Code, http.StatusOK)
	}
	if contentRec.Body.String() != imageBytes {
		t.Errorf("content body = %q, want %q", contentRec.Body.String(), imageBytes)
	}
	if got := contentRec.Header().Get("Content-Type"); got == "" {
		t.Errorf("Content-Type header is empty")
	}

	t.Run("unknown image id is not found", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/menu-images/missing/content", nil, nil)
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
		}
	})
}

func TestRouter_AdminStoreProfile_Update(t *testing.T) {
	handler := resetServer(t)

	body, _ := json.Marshal(map[string]string{
		"songRequestCopy": "song", "requestCopy": "request", "eventCopy": "event",
	})

	t.Run("without auth is rejected", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/store-profile", body, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/store-profile", body, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
}
