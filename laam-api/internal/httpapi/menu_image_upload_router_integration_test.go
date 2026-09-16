package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

// pngSignature is the 8-byte PNG magic number http.DetectContentType keys on.
var pngSignature = []byte("\x89PNG\r\n\x1a\n")

func createMenuItemForImageUpload(t *testing.T, handler http.Handler) string {
	t.Helper()
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
	if err := json.Unmarshal(rec.Body.Bytes(), &bootstrap); err != nil || len(bootstrap.Items) != 1 {
		t.Fatalf("create menu item: err=%v body=%s", err, rec.Body.String())
	}
	return bootstrap.Items[0].ID
}

func postMenuImage(t *testing.T, handler http.Handler, itemID string, filename string, contentType string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	header := make(map[string][]string)
	header["Content-Disposition"] = []string{`form-data; name="image"; filename="` + filename + `"`}
	header["Content-Type"] = []string{contentType}
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("create form part: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write form part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/menu-items/"+itemID+"/images", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+testCfg.AdminAPIToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func pngOfSize(size int) []byte {
	content := make([]byte, size)
	copy(content, pngSignature)
	return content
}

func countMenuImages(t *testing.T) int {
	t.Helper()
	var count int
	if err := testPool.QueryRow(context.Background(), `SELECT COUNT(*) FROM menu_item_images`).Scan(&count); err != nil {
		t.Fatalf("count menu_item_images: %v", err)
	}
	return count
}

// The admin web (features/menu/model.ts) caps a picked file at 8 MiB and
// only offers JPEG/PNG/WebP, so an upload at exactly that cap must still
// succeed while anything past it is refused before reaching the database.
func TestRouter_MenuImageUpload_AcceptsImageAtAdminWebSizeCap(t *testing.T) {
	handler := resetServer(t)
	itemID := createMenuItemForImageUpload(t, handler)

	rec := postMenuImage(t, handler, itemID, "fries.png", "image/png", pngOfSize(8<<20))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
}

func TestRouter_MenuImageUpload_RejectsFileOverSizeCap(t *testing.T) {
	handler := resetServer(t)
	itemID := createMenuItemForImageUpload(t, handler)

	rec := postMenuImage(t, handler, itemID, "fries.png", "image/png", pngOfSize(8<<20+1))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusRequestEntityTooLarge, rec.Body.String())
	}
	if got := countMenuImages(t); got != 0 {
		t.Fatalf("menu_item_images = %d, want 0", got)
	}
}

func TestRouter_MenuImageUpload_RejectsOversizedRequestBody(t *testing.T) {
	handler := resetServer(t)
	itemID := createMenuItemForImageUpload(t, handler)

	rec := postMenuImage(t, handler, itemID, "fries.png", "image/png", pngOfSize(16<<20))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusRequestEntityTooLarge, rec.Body.String())
	}
	if got := countMenuImages(t); got != 0 {
		t.Fatalf("menu_item_images = %d, want 0", got)
	}
}

func TestRouter_MenuImageUpload_RejectsNonImageContent(t *testing.T) {
	cases := []struct {
		name        string
		contentType string
		content     []byte
	}{
		{name: "html declared as png", contentType: "image/png", content: []byte("<html><script>alert(1)</script></html>")},
		{name: "plain text", contentType: "text/plain", content: []byte("not an image")},
		{name: "gif is not an allowed type", contentType: "image/gif", content: []byte("GIF89a\x01\x00\x01\x00")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handler := resetServer(t)
			itemID := createMenuItemForImageUpload(t, handler)

			rec := postMenuImage(t, handler, itemID, "fries.png", tc.contentType, tc.content)
			if rec.Code != http.StatusUnsupportedMediaType {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusUnsupportedMediaType, rec.Body.String())
			}
			if got := countMenuImages(t); got != 0 {
				t.Fatalf("menu_item_images = %d, want 0", got)
			}
		})
	}
}

// The stored MIME type is what GET /api/v1/menu-images/{id}/content later
// serves as Content-Type, so it comes from the sniffed bytes rather than the
// client-declared part header.
func TestRouter_MenuImageUpload_StoresSniffedMimeType(t *testing.T) {
	handler := resetServer(t)
	itemID := createMenuItemForImageUpload(t, handler)

	rec := postMenuImage(t, handler, itemID, "fries.png", "application/octet-stream", pngOfSize(64))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var mimeType string
	if err := testPool.QueryRow(context.Background(), `SELECT mime_type FROM menu_item_images`).Scan(&mimeType); err != nil {
		t.Fatalf("read mime_type: %v", err)
	}
	if mimeType != "image/png" {
		t.Fatalf("mime_type = %q, want image/png", mimeType)
	}
}
