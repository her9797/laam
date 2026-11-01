package httpapi

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

type menuContentLabel struct {
	Text  string `json:"text"`
	Color string `json:"color"`
}

type menuContentBootstrap struct {
	Items []struct {
		ID                  string             `json:"id"`
		Description         string             `json:"description"`
		PosDescription      string             `json:"posDescription"`
		DescriptionOverride string             `json:"descriptionOverride"`
		CustomLabels        []menuContentLabel `json:"customLabels"`
		Labels              []menuContentLabel `json:"labels"`
	} `json:"items"`
}

func decodeMenuContentBootstrap(t *testing.T, body []byte) menuContentBootstrap {
	t.Helper()
	var data menuContentBootstrap
	if err := json.Unmarshal(body, &data); err != nil {
		t.Fatalf("decode bootstrap: %v, body = %s", err, body)
	}
	return data
}

func TestRouter_AdminMenuLabelsRouteRemoved(t *testing.T) {
	handler := resetServer(t)
	for _, path := range []string{"/api/v1/admin/menu-labels", "/api/v1/admin/menu-labels/any"} {
		if rec := doRequest(t, handler, http.MethodPost, path, []byte(`{"text":"a","color":"green"}`), adminHeaders()); rec.Code != http.StatusNotFound {
			t.Errorf("POST %s status = %d, want %d", path, rec.Code, http.StatusNotFound)
		}
	}
	rec := doRequest(t, handler, http.MethodGet, "/api/v1/bootstrap", nil, nil)
	if strings.Contains(rec.Body.String(), `"menuLabels"`) || strings.Contains(rec.Body.String(), `"labelIds"`) {
		t.Errorf("bootstrap still exposes shared label fields: %s", rec.Body.String())
	}
}

func TestRouter_AdminMenuItemContent(t *testing.T) {
	handler := resetServer(t)

	catBody, _ := json.Marshal(map[string]any{"id": "food", "label": "Food", "isVisible": true})
	doRequest(t, handler, http.MethodPost, "/api/v1/admin/categories", catBody, adminHeaders())
	itemBody, _ := json.Marshal(map[string]any{"categoryId": "food", "name": "Fries", "description": "crispy", "price": "5000", "isVisible": true})
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/menu-items", itemBody, adminHeaders())
	itemID := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0].ID
	if _, err := testPool.Exec(t.Context(), `UPDATE menu_items SET toss_labels = ARRAY['추천'], label_colors = ARRAY['amber'] WHERE id = $1`, itemID); err != nil {
		t.Fatalf("seed toss labels: %v", err)
	}
	contentPath := "/api/v1/admin/menu-items/" + itemID + "/content"
	tossLabels := []menuContentLabel{{Text: "추천", Color: "amber"}}

	t.Run("bootstrap before override keeps Toss content", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/bootstrap", nil, nil)
		if !strings.Contains(rec.Body.String(), `"customLabels":[]`) {
			t.Errorf("bootstrap item customLabels is not an empty array: %s", rec.Body.String())
		}
		item := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0]
		if item.Description != "crispy" || item.PosDescription != "crispy" || item.DescriptionOverride != "" {
			t.Errorf("descriptions = %q / %q / %q", item.Description, item.PosDescription, item.DescriptionOverride)
		}
		if !reflect.DeepEqual(item.Labels, tossLabels) {
			t.Errorf("labels = %+v, want Toss label 추천/amber", item.Labels)
		}
	})

	t.Run("without auth is rejected", func(t *testing.T) {
		if rec := doRequest(t, handler, http.MethodPatch, contentPath, []byte(`{}`), nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("wrong method is rejected", func(t *testing.T) {
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
			if rec := doRequest(t, handler, method, contentPath, nil, adminHeaders()); rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s status = %d, want %d", method, rec.Code, http.StatusMethodNotAllowed)
			}
		}
	})

	body, _ := json.Marshal(map[string]any{
		"descriptionOverride": "  바삭한 감자  ",
		"labels":              []map[string]string{{"text": " 신규 ", "color": "blue"}, {"text": "시그니처", "color": "pink"}},
	})
	rec = doRequest(t, handler, http.MethodPatch, contentPath, body, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH content status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	item := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0]
	if item.Description != "바삭한 감자" || item.PosDescription != "crispy" || item.DescriptionOverride != "바삭한 감자" {
		t.Fatalf("descriptions after PATCH = %q / %q / %q", item.Description, item.PosDescription, item.DescriptionOverride)
	}
	want := []menuContentLabel{{Text: "신규", Color: "blue"}, {Text: "시그니처", Color: "pink"}}
	if !reflect.DeepEqual(item.CustomLabels, want) || !reflect.DeepEqual(item.Labels, want) {
		t.Fatalf("after PATCH customLabels = %+v, labels = %+v, want %+v", item.CustomLabels, item.Labels, want)
	}

	t.Run("public menu uses the effective content", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/menu", nil, nil)
		item := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0]
		if item.Description != "바삭한 감자" || !reflect.DeepEqual(item.Labels, want) {
			t.Errorf("menu item = %+v", item)
		}
	})

	t.Run("validation", func(t *testing.T) {
		label := func(text, color string) map[string]string { return map[string]string{"text": text, "color": color} }
		six := []map[string]string{label("a", "green"), label("b", "green"), label("c", "green"), label("d", "green"), label("e", "green"), label("f", "green")}
		cases := map[string]struct {
			path string
			body any
			want int
		}{
			"too long description": {contentPath, map[string]any{"descriptionOverride": strings.Repeat("가", 301)}, http.StatusBadRequest},
			"too many labels":      {contentPath, map[string]any{"labels": six}, http.StatusBadRequest},
			"blank text":           {contentPath, map[string]any{"labels": []map[string]string{label("  ", "green")}}, http.StatusBadRequest},
			"too long text":        {contentPath, map[string]any{"labels": []map[string]string{label(strings.Repeat("가", 21), "green")}}, http.StatusBadRequest},
			"unknown color":        {contentPath, map[string]any{"labels": []map[string]string{label("인기", "red")}}, http.StatusBadRequest},
			"missing color":        {contentPath, map[string]any{"labels": []map[string]string{{"text": "인기"}}}, http.StatusBadRequest},
			"duplicate text":       {contentPath, map[string]any{"labels": []map[string]string{label("Best", "green"), label(" BEST ", "blue")}}, http.StatusBadRequest},
			"unknown item":         {"/api/v1/admin/menu-items/missing/content", map[string]any{"labels": []any{}}, http.StatusNotFound},
		}
		for name, c := range cases {
			body, _ := json.Marshal(c.body)
			if rec := doRequest(t, handler, http.MethodPatch, c.path, body, adminHeaders()); rec.Code != c.want {
				t.Errorf("%s: status = %d, want %d, body = %s", name, rec.Code, c.want, rec.Body.String())
			}
		}
		if rec := doRequest(t, handler, http.MethodPatch, contentPath, []byte(`{`), adminHeaders()); rec.Code != http.StatusBadRequest {
			t.Errorf("invalid json status = %d, want %d", rec.Code, http.StatusBadRequest)
		}
		item := decodeMenuContentBootstrap(t, doRequest(t, handler, http.MethodGet, "/api/v1/bootstrap", nil, nil).Body.Bytes()).Items[0]
		if item.DescriptionOverride != "바삭한 감자" || !reflect.DeepEqual(item.CustomLabels, want) {
			t.Errorf("content changed after rejected PATCHes: %q %+v", item.DescriptionOverride, item.CustomLabels)
		}
	})

	t.Run("missing fields clear the override and labels", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPatch, contentPath, []byte(`{}`), adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"customLabels":[]`) {
			t.Errorf("customLabels after clear is not an empty array: %s", rec.Body.String())
		}
		item := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0]
		if item.Description != "crispy" || item.DescriptionOverride != "" {
			t.Fatalf("after clear = %q / %q", item.Description, item.DescriptionOverride)
		}
		if !reflect.DeepEqual(item.Labels, tossLabels) {
			t.Fatalf("labels after clear = %+v, want Toss label fallback", item.Labels)
		}
	})
}
