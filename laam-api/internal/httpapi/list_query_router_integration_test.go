package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
)

func createCustomerRequestViaAPI(t *testing.T, handler http.Handler, tableNumber string, text string) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"tableNumber": tableNumber, "text": text})
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/customer-requests", body, requestHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("create customer request status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
}

func TestRouter_AdminCustomerRequests_NoParamsReturnsLegacyArray(t *testing.T) {
	handler := resetServer(t)
	createCustomerRequestViaAPI(t, handler, "T-01", "napkins please")

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var asArray []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &asArray); err != nil {
		t.Fatalf("decode as array: %v (body = %s)", err, rec.Body.String())
	}
	if len(asArray) != 1 {
		t.Fatalf("len(asArray) = %d, want 1", len(asArray))
	}
}

func TestRouter_AdminCustomerRequests_WithParamsReturnsEnvelope(t *testing.T) {
	handler := resetServer(t)
	createCustomerRequestViaAPI(t, handler, "T-01", "napkins please")
	createCustomerRequestViaAPI(t, handler, "T-02", "more ice")

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests?page=1&pageSize=1", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
		Page     int `json:"page"`
		PageSize int `json:"pageSize"`
		Total    int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode as envelope: %v (body = %s)", err, rec.Body.String())
	}
	if envelope.Total != 2 || len(envelope.Items) != 1 || envelope.Page != 1 || envelope.PageSize != 1 {
		t.Fatalf("envelope = %+v, want total=2 items=1 page=1 pageSize=1", envelope)
	}
}

func TestRouter_AdminCustomerRequests_InvalidParamIsBadRequest(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/customer-requests?sort=id", nil, adminHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func createSpecialRequestViaAPI(t *testing.T, handler http.Handler, tableNumber string, name string) {
	t.Helper()
	payload := map[string]string{
		"tableNumber": tableNumber,
		"gender":      "female",
		"name":        name,
		"age":         "20s",
		"residence":   "Seoul",
		"instagram":   "@" + name,
		"idealType":   "kind",
		"text":        "hi",
	}
	body, _ := json.Marshal(payload)
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/special-requests", body, requestHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("create special request status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
}

func TestRouter_AdminSpecialRequests_NoParamsReturnsLegacyArray(t *testing.T) {
	handler := resetServer(t)
	createSpecialRequestViaAPI(t, handler, "T-01", "Kim")

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/special-requests", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var asArray []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &asArray); err != nil {
		t.Fatalf("decode as array: %v (body = %s)", err, rec.Body.String())
	}
	if len(asArray) != 1 {
		t.Fatalf("len(asArray) = %d, want 1", len(asArray))
	}
}

func TestRouter_AdminSpecialRequests_WithParamsReturnsEnvelope(t *testing.T) {
	handler := resetServer(t)
	createSpecialRequestViaAPI(t, handler, "T-01", "Kim")
	createSpecialRequestViaAPI(t, handler, "T-02", "Lee")

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/special-requests?gender=female&sort=name&order=asc", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope struct {
		Items []struct {
			Name string `json:"name"`
		} `json:"items"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode as envelope: %v (body = %s)", err, rec.Body.String())
	}
	if envelope.Total != 2 || len(envelope.Items) != 2 || envelope.Items[0].Name != "Kim" {
		t.Fatalf("envelope = %+v, want total=2 items=[Kim, Lee]", envelope)
	}
}

func TestRouter_AdminSpecialRequests_InvalidParamIsBadRequest(t *testing.T) {
	handler := resetServer(t)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/special-requests?gender=unspecified", nil, adminHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}
