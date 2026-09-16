package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
)

func requestHeaders() map[string]string {
	return map[string]string{"Authorization": "Bearer " + testCfg.PaymentAPIToken}
}

func TestRouter_RequestCreationRequiresServerAuth(t *testing.T) {
	for _, path := range []string{"/api/v1/customer-requests", "/api/v1/special-requests"} {
		t.Run(path, func(t *testing.T) {
			handler := resetServer(t)
			body := []byte(`{"tableNumber":"T-01","text":"help","gender":"female","name":"Test","age":"20","residence":"Seoul","instagram":"test","idealType":"kind"}`)
			for _, token := range []string{"", "wrong-token", testCfg.AdminAPIToken} {
				headers := map[string]string{}
				if token != "" {
					headers["Authorization"] = "Bearer " + token
				}
				rec := doRequest(t, handler, http.MethodPost, path, body, headers)
				if rec.Code != http.StatusUnauthorized {
					t.Errorf("unauthorized request status = %d, want %d", rec.Code, http.StatusUnauthorized)
				}
			}
			rec := doRequest(t, handler, http.MethodPost, path, body, map[string]string{
				"Authorization": "Bearer " + testCfg.PaymentAPIToken,
			})
			if rec.Code != http.StatusCreated {
				t.Fatalf("authorized request status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
			}
			list := doRequest(t, handler, http.MethodGet, "/api/v1/admin/"+path[len("/api/v1/"):], nil, adminHeaders())
			var count []map[string]any
			if err := json.Unmarshal(list.Body.Bytes(), &count); err != nil {
				t.Fatal(err)
			}
			if len(count) != 1 {
				t.Errorf("stored requests = %d, want only the authorized request", len(count))
			}
		})
	}
}
