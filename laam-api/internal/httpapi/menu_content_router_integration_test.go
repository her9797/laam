package httpapi

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

const menuLabelsPath = "/api/v1/admin/menu-labels"

type menuContentBootstrap struct {
	Items []struct {
		ID                  string   `json:"id"`
		Description         string   `json:"description"`
		PosDescription      string   `json:"posDescription"`
		DescriptionOverride string   `json:"descriptionOverride"`
		LabelIDs            []string `json:"labelIds"`
		Labels              []struct {
			Text  string `json:"text"`
			Color string `json:"color"`
		} `json:"labels"`
	} `json:"items"`
	MenuLabels []struct {
		ID        string `json:"id"`
		Text      string `json:"text"`
		Color     string `json:"color"`
		SortOrder int    `json:"sortOrder"`
	} `json:"menuLabels"`
}

func decodeMenuContentBootstrap(t *testing.T, body []byte) menuContentBootstrap {
	t.Helper()
	var data menuContentBootstrap
	if err := json.Unmarshal(body, &data); err != nil {
		t.Fatalf("decode bootstrap: %v, body = %s", err, body)
	}
	return data
}

func (data menuContentBootstrap) labelID(t *testing.T, text string) string {
	t.Helper()
	for _, label := range data.MenuLabels {
		if label.Text == text {
			return label.ID
		}
	}
	t.Fatalf("menu label %q not found in %+v", text, data.MenuLabels)
	return ""
}

func TestRouter_AdminMenuLabels(t *testing.T) {
	handler := resetServer(t)

	t.Run("without auth is rejected", func(t *testing.T) {
		for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodDelete} {
			path := menuLabelsPath
			if method != http.MethodPost {
				path += "/any"
			}
			if rec := doRequest(t, handler, method, path, []byte(`{"text":"a"}`), nil); rec.Code != http.StatusUnauthorized {
				t.Errorf("%s %s status = %d, want %d", method, path, rec.Code, http.StatusUnauthorized)
			}
		}
	})

	t.Run("wrong method is rejected", func(t *testing.T) {
		if rec := doRequest(t, handler, http.MethodGet, menuLabelsPath, nil, adminHeaders()); rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("GET collection status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
		}
		if rec := doRequest(t, handler, http.MethodPut, menuLabelsPath+"/any", nil, adminHeaders()); rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("PUT item status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
		}
	})

	rec := doRequest(t, handler, http.MethodPost, menuLabelsPath, []byte(`{"text":" 시그니처 ","color":"pink"}`), adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	data := decodeMenuContentBootstrap(t, rec.Body.Bytes())
	if len(data.MenuLabels) != 1 || data.MenuLabels[0].ID == "" || data.MenuLabels[0].Text != "시그니처" || data.MenuLabels[0].Color != "pink" {
		t.Fatalf("menuLabels after POST = %+v", data.MenuLabels)
	}
	signatureID := data.MenuLabels[0].ID

	rec = doRequest(t, handler, http.MethodPost, menuLabelsPath, []byte(`{"text":"인기"}`), adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST without color status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := decodeMenuContentBootstrap(t, rec.Body.Bytes()).MenuLabels; len(got) != 2 || got[1].Color != "green" {
		t.Fatalf("menuLabels after POST without color = %+v, want default green", got)
	}

	t.Run("POST validation", func(t *testing.T) {
		cases := map[string]struct {
			body []byte
			want int
		}{
			"invalid json":   {[]byte(`{`), http.StatusBadRequest},
			"empty text":     {[]byte(`{"text":"  "}`), http.StatusBadRequest},
			"too long text":  {[]byte(`{"text":"` + strings.Repeat("가", 21) + `"}`), http.StatusBadRequest},
			"unknown color":  {[]byte(`{"text":"새 라벨","color":"red"}`), http.StatusBadRequest},
			"duplicate text": {[]byte(`{"text":"시그니처","color":"blue"}`), http.StatusConflict},
		}
		for name, c := range cases {
			if rec := doRequest(t, handler, http.MethodPost, menuLabelsPath, c.body, adminHeaders()); rec.Code != c.want {
				t.Errorf("%s: status = %d, want %d, body = %s", name, rec.Code, c.want, rec.Body.String())
			}
		}
	})

	t.Run("PATCH", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPatch, menuLabelsPath+"/"+signatureID, []byte(`{"text":"대표","color":"blue"}`), adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("PATCH status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
		if got := decodeMenuContentBootstrap(t, rec.Body.Bytes()).MenuLabels[0]; got.ID != signatureID || got.Text != "대표" || got.Color != "blue" {
			t.Fatalf("menuLabels[0] after PATCH = %+v", got)
		}
		cases := map[string]struct {
			path string
			body string
			want int
		}{
			"unknown id":     {menuLabelsPath + "/missing", `{"text":"없음"}`, http.StatusNotFound},
			"duplicate text": {menuLabelsPath + "/" + signatureID, `{"text":"인기"}`, http.StatusConflict},
			"unknown color":  {menuLabelsPath + "/" + signatureID, `{"text":"대표","color":"red"}`, http.StatusBadRequest},
			"invalid json":   {menuLabelsPath + "/" + signatureID, `{`, http.StatusBadRequest},
		}
		for name, c := range cases {
			if rec := doRequest(t, handler, http.MethodPatch, c.path, []byte(c.body), adminHeaders()); rec.Code != c.want {
				t.Errorf("%s: status = %d, want %d, body = %s", name, rec.Code, c.want, rec.Body.String())
			}
		}
	})

	t.Run("DELETE", func(t *testing.T) {
		if rec := doRequest(t, handler, http.MethodDelete, menuLabelsPath+"/missing", nil, adminHeaders()); rec.Code != http.StatusNotFound {
			t.Errorf("DELETE unknown status = %d, want %d", rec.Code, http.StatusNotFound)
		}
		rec := doRequest(t, handler, http.MethodDelete, menuLabelsPath+"/"+signatureID, nil, adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("DELETE status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
		if got := decodeMenuContentBootstrap(t, rec.Body.Bytes()).MenuLabels; len(got) != 1 || got[0].Text != "인기" {
			t.Fatalf("menuLabels after DELETE = %+v", got)
		}
	})
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
	doRequest(t, handler, http.MethodPost, menuLabelsPath, []byte(`{"text":"시그니처","color":"pink"}`), adminHeaders())
	rec = doRequest(t, handler, http.MethodPost, menuLabelsPath, []byte(`{"text":"신규","color":"blue"}`), adminHeaders())
	labels := decodeMenuContentBootstrap(t, rec.Body.Bytes())
	signatureID, freshID := labels.labelID(t, "시그니처"), labels.labelID(t, "신규")
	contentPath := "/api/v1/admin/menu-items/" + itemID + "/content"

	t.Run("bootstrap before override keeps Toss content", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/bootstrap", nil, nil)
		if !strings.Contains(rec.Body.String(), `"labelIds":[]`) {
			t.Errorf("bootstrap item labelIds is not an empty array: %s", rec.Body.String())
		}
		item := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0]
		if item.Description != "crispy" || item.PosDescription != "crispy" || item.DescriptionOverride != "" {
			t.Errorf("descriptions = %q / %q / %q", item.Description, item.PosDescription, item.DescriptionOverride)
		}
		if len(item.Labels) != 1 || item.Labels[0].Text != "추천" || item.Labels[0].Color != "amber" {
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

	body, _ := json.Marshal(map[string]any{"descriptionOverride": "  바삭한 감자  ", "labelIds": []string{freshID, signatureID}})
	rec = doRequest(t, handler, http.MethodPatch, contentPath, body, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH content status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	item := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0]
	if item.Description != "바삭한 감자" || item.PosDescription != "crispy" || item.DescriptionOverride != "바삭한 감자" {
		t.Fatalf("descriptions after PATCH = %q / %q / %q", item.Description, item.PosDescription, item.DescriptionOverride)
	}
	if !reflect.DeepEqual(item.LabelIDs, []string{freshID, signatureID}) {
		t.Fatalf("labelIds = %v, want [%s %s]", item.LabelIDs, freshID, signatureID)
	}
	if len(item.Labels) != 2 || item.Labels[0].Text != "신규" || item.Labels[0].Color != "blue" || item.Labels[1].Text != "시그니처" || item.Labels[1].Color != "pink" {
		t.Fatalf("labels after PATCH = %+v, want assigned labels in order", item.Labels)
	}

	t.Run("public menu uses the effective content", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, "/api/v1/menu", nil, nil)
		item := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0]
		if item.Description != "바삭한 감자" || len(item.Labels) != 2 || item.Labels[0].Text != "신규" {
			t.Errorf("menu item = %+v", item)
		}
	})

	t.Run("validation", func(t *testing.T) {
		six := []string{"a", "b", "c", "d", "e", "f"}
		cases := map[string]struct {
			path string
			body any
			want int
		}{
			"too long description": {contentPath, map[string]any{"descriptionOverride": strings.Repeat("가", 301), "labelIds": []string{}}, http.StatusBadRequest},
			"too many labels":      {contentPath, map[string]any{"descriptionOverride": "", "labelIds": six}, http.StatusBadRequest},
			"duplicate labels":     {contentPath, map[string]any{"labelIds": []string{signatureID, signatureID}}, http.StatusBadRequest},
			"unknown label":        {contentPath, map[string]any{"labelIds": []string{"missing"}}, http.StatusBadRequest},
			"unknown item":         {"/api/v1/admin/menu-items/missing/content", map[string]any{"labelIds": []string{}}, http.StatusNotFound},
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
	})

	t.Run("deleting a label removes its assignment", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodDelete, menuLabelsPath+"/"+freshID, nil, adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("DELETE label status = %d, body = %s", rec.Code, rec.Body.String())
		}
		if got := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0].LabelIDs; !reflect.DeepEqual(got, []string{signatureID}) {
			t.Fatalf("labelIds after label delete = %v, want [%s]", got, signatureID)
		}
	})

	t.Run("missing fields clear the override and assignments", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPatch, contentPath, []byte(`{}`), adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		item := decodeMenuContentBootstrap(t, rec.Body.Bytes()).Items[0]
		if item.Description != "crispy" || item.DescriptionOverride != "" || len(item.LabelIDs) != 0 {
			t.Fatalf("after clear = %q / %q / %v", item.Description, item.DescriptionOverride, item.LabelIDs)
		}
		if len(item.Labels) != 1 || item.Labels[0].Text != "추천" || item.Labels[0].Color != "amber" {
			t.Fatalf("labels after clear = %+v, want Toss label fallback", item.Labels)
		}
	})
}
