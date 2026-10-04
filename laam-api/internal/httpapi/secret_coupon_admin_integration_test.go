package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestRouter_AdminSecretCoupons(t *testing.T) {
	handler := resetServer(t)
	const base = "/api/v1/admin/secret-coupons"

	t.Run("requires admin auth", func(t *testing.T) {
		for _, p := range []string{base, base + "/vinyl-laam", base + "/vinyl-laam/redeem", base + "/vinyl-laam/reset"} {
			rec := doRequest(t, handler, http.MethodGet, p, nil, nil)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s status = %d, want 401", p, rec.Code)
			}
		}
	})

	t.Run("list includes null keys", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, base, nil, adminHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		var raw []map[string]json.RawMessage
		if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil || len(raw) != 5 {
			t.Fatalf("decode = %v, len = %d", err, len(raw))
		}
		for _, k := range []string{"id", "rewardLabel", "sortOrder", "claimedAt", "tableNumber", "redeemedAt", "hidingNote"} {
			if _, ok := raw[0][k]; !ok {
				t.Errorf("missing key %q in %s", k, rec.Body.String())
			}
		}
		if string(raw[0]["claimedAt"]) != "null" || string(raw[0]["redeemedAt"]) != "null" {
			t.Errorf("claimedAt/redeemedAt = %s/%s, want null", raw[0]["claimedAt"], raw[0]["redeemedAt"])
		}
	})

	t.Run("method not allowed", func(t *testing.T) {
		cases := [][2]string{
			{http.MethodPost, base},
			{http.MethodGet, base + "/vinyl-laam"},
			{http.MethodGet, base + "/vinyl-laam/redeem"},
			{http.MethodPatch, base + "/vinyl-laam/reset"},
		}
		for _, c := range cases {
			rec := doRequest(t, handler, c[0], c[1], nil, adminHeaders())
			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s status = %d, want 405", c[0], c[1], rec.Code)
			}
		}
	})

	t.Run("patch validates and updates", func(t *testing.T) {
		ok := doRequest(t, handler, http.MethodPatch, base+"/vinyl-laam", []byte(`{"rewardLabel":" 2만원 할인권 "}`), adminHeaders())
		if ok.Code != http.StatusOK || !strings.Contains(ok.Body.String(), `"rewardLabel":"2만원 할인권"`) {
			t.Fatalf("status = %d, body = %s", ok.Code, ok.Body.String())
		}
		for _, b := range []string{`{"rewardLabel":"  "}`, `{"rewardLabel":"` + strings.Repeat("가", 41) + `"}`, `{bad`} {
			rec := doRequest(t, handler, http.MethodPatch, base+"/vinyl-laam", []byte(b), adminHeaders())
			if rec.Code != http.StatusBadRequest {
				t.Errorf("body %.20s status = %d, want 400", b, rec.Code)
			}
		}
		rec := doRequest(t, handler, http.MethodPatch, base+"/nope", []byte(`{"rewardLabel":"x"}`), adminHeaders())
		if rec.Code != http.StatusNotFound {
			t.Errorf("unknown status = %d, want 404", rec.Code)
		}
	})

	t.Run("patch hidingNote partially", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPatch, base+"/table-badge", []byte(`{"hidingNote":"  새 메모  "}`), adminHeaders())
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"hidingNote":"새 메모"`) {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		rec = doRequest(t, handler, http.MethodPatch, base+"/table-badge", []byte(`{"rewardLabel":"라벨"}`), adminHeaders())
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"rewardLabel":"라벨"`) || !strings.Contains(rec.Body.String(), `"hidingNote":"새 메모"`) {
			t.Fatalf("label-only status = %d, body = %s", rec.Code, rec.Body.String())
		}
		rec = doRequest(t, handler, http.MethodPatch, base+"/table-badge", []byte(`{"hidingNote":""}`), adminHeaders())
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"hidingNote":""`) || !strings.Contains(rec.Body.String(), `"rewardLabel":"라벨"`) {
			t.Fatalf("empty note status = %d, body = %s", rec.Code, rec.Body.String())
		}
		for _, b := range []string{`{}`, `{"hidingNote":"` + strings.Repeat("가", 201) + `"}`} {
			rec := doRequest(t, handler, http.MethodPatch, base+"/table-badge", []byte(b), adminHeaders())
			if rec.Code != http.StatusBadRequest {
				t.Errorf("body %.20s status = %d, want 400", b, rec.Code)
			}
		}
		rec = doRequest(t, handler, http.MethodPatch, base+"/nope", []byte(`{"hidingNote":"x"}`), adminHeaders())
		if rec.Code != http.StatusNotFound {
			t.Errorf("unknown status = %d, want 404", rec.Code)
		}
	})

	t.Run("list exposes seeded hidingNote", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodGet, base, nil, adminHeaders())
		if !strings.Contains(rec.Body.String(), `"hidingNote":"손님 홈 화면의 LP판을 누르면 발견"`) {
			t.Errorf("body = %s", rec.Body.String())
		}
	})

	t.Run("customer claim response hides hidingNote", func(t *testing.T) {
		claimBody, _ := json.Marshal(map[string]string{"tableNumber": "4"})
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/secret-coupons/vinyl-laam/claim", claimBody, requestHeaders())
		if rec.Code != http.StatusCreated {
			t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "hidingNote") {
			t.Errorf("claim body leaks hidingNote: %s", rec.Body.String())
		}
	})

	claimedAtBody := func(t *testing.T, id string) []byte {
		t.Helper()
		rec := doRequest(t, handler, http.MethodGet, base, nil, adminHeaders())
		var items []struct {
			ID        string  `json:"id"`
			ClaimedAt *string `json:"claimedAt"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil {
			t.Fatalf("decode list: %v", err)
		}
		for _, c := range items {
			if c.ID == id {
				if c.ClaimedAt == nil {
					return []byte(`{"claimedAt":"2026-01-02T03:04:05Z"}`)
				}
				b, _ := json.Marshal(map[string]string{"claimedAt": *c.ClaimedAt})
				return b
			}
		}
		t.Fatalf("coupon %s not in list", id)
		return nil
	}

	t.Run("redeem and reset require a valid claimedAt body", func(t *testing.T) {
		for _, action := range []string{"redeem", "reset"} {
			for _, b := range [][]byte{nil, []byte(`{bad`), []byte(`{}`), []byte(`{"claimedAt":""}`), []byte(`{"claimedAt":"yesterday"}`), []byte(`{"claimedAt":null}`)} {
				rec := doRequest(t, handler, http.MethodPost, base+"/vinyl-laam/"+action, b, adminHeaders())
				if rec.Code != http.StatusBadRequest {
					t.Errorf("%s body %q status = %d, want 400", action, b, rec.Code)
				}
			}
		}
	})

	t.Run("redeem and reset flow", func(t *testing.T) {
		if rec := doRequest(t, handler, http.MethodPost, base+"/table-badge/redeem", claimedAtBody(t, "table-badge"), adminHeaders()); rec.Code != http.StatusConflict {
			t.Errorf("redeem unclaimed status = %d, want 409", rec.Code)
		}
		if rec := doRequest(t, handler, http.MethodPost, base+"/table-badge/reset", claimedAtBody(t, "table-badge"), adminHeaders()); rec.Code != http.StatusConflict {
			t.Errorf("reset unclaimed status = %d, want 409", rec.Code)
		}
		if rec := doRequest(t, handler, http.MethodPost, base+"/nope/redeem", []byte(`{"claimedAt":"2026-01-02T03:04:05Z"}`), adminHeaders()); rec.Code != http.StatusNotFound {
			t.Errorf("redeem unknown status = %d, want 404", rec.Code)
		}
		claimBody, _ := json.Marshal(map[string]string{"tableNumber": "3"})
		if rec := doRequest(t, handler, http.MethodPost, "/api/v1/secret-coupons/table-badge/claim", claimBody, requestHeaders()); rec.Code != http.StatusCreated {
			t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
		}
		stale := []byte(`{"claimedAt":"2000-01-01T00:00:00Z"}`)
		if rec := doRequest(t, handler, http.MethodPost, base+"/table-badge/redeem", stale, adminHeaders()); rec.Code != http.StatusConflict {
			t.Errorf("redeem stale status = %d, want 409", rec.Code)
		}
		if rec := doRequest(t, handler, http.MethodPost, base+"/table-badge/reset", stale, adminHeaders()); rec.Code != http.StatusConflict {
			t.Errorf("reset stale status = %d, want 409", rec.Code)
		}
		current := claimedAtBody(t, "table-badge")
		rec := doRequest(t, handler, http.MethodPost, base+"/table-badge/redeem", current, adminHeaders())
		if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), `"redeemedAt":null`) {
			t.Fatalf("redeem status = %d, body = %s", rec.Code, rec.Body.String())
		}
		if rec := doRequest(t, handler, http.MethodPost, base+"/table-badge/redeem", current, adminHeaders()); rec.Code != http.StatusConflict {
			t.Errorf("redeem twice status = %d, want 409", rec.Code)
		}
		rec = doRequest(t, handler, http.MethodPost, base+"/table-badge/reset", current, adminHeaders())
		body := rec.Body.String()
		if rec.Code != http.StatusOK || !strings.Contains(body, `"claimedAt":null`) || !strings.Contains(body, `"redeemedAt":null`) || !strings.Contains(body, `"tableNumber":""`) {
			t.Errorf("reset status = %d, body = %s", rec.Code, body)
		}
		if rec := doRequest(t, handler, http.MethodPost, base+"/table-badge/reset", current, adminHeaders()); rec.Code != http.StatusConflict {
			t.Errorf("reset twice status = %d, want 409", rec.Code)
		}
		if rec := doRequest(t, handler, http.MethodPost, base+"/nope/reset", current, adminHeaders()); rec.Code != http.StatusNotFound {
			t.Errorf("reset unknown status = %d, want 404", rec.Code)
		}
	})
}
