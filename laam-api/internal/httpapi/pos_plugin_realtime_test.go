package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/her9797/laam/laam-api/internal/config"
)

const (
	testAnonKey      = "sb_publishable_test-anon-key"
	testServiceKey   = "sb_secret_must-never-leak"
	testPluginToken  = "plugin-token"
	realtimeEndpoint = "/api/v1/pos-plugin/realtime-config"
)

func realtimeConfigMux(cfg config.Config) *http.ServeMux {
	mux := http.NewServeMux()
	registerPOSPluginRoutes(mux, nil, cfg, nil)
	return mux
}

func getRealtimeConfig(t *testing.T, mux http.Handler, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, realtimeEndpoint, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestPOSPluginRealtimeConfig_RequiresPluginToken(t *testing.T) {
	mux := realtimeConfigMux(config.Config{
		AllowedOrigin:        "*",
		POSPluginAPIToken:    testPluginToken,
		SupabaseURL:          "https://project-ref.supabase.co",
		SupabaseAnonKey:      testAnonKey,
		SupabaseBroadcastKey: testServiceKey,
	})

	for _, token := range []string{"", "wrong-token"} {
		rec := getRealtimeConfig(t, mux, token)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("token %q: status = %d, want %d", token, rec.Code, http.StatusUnauthorized)
		}
		if strings.Contains(rec.Body.String(), testAnonKey) {
			t.Errorf("token %q: unauthorized response leaked the anon key: %s", token, rec.Body.String())
		}
	}
}

func TestPOSPluginRealtimeConfig_EnabledShape(t *testing.T) {
	mux := realtimeConfigMux(config.Config{
		AllowedOrigin:        "*",
		POSPluginAPIToken:    testPluginToken,
		SupabaseURL:          "https://project-ref.supabase.co/",
		SupabaseAnonKey:      testAnonKey,
		SupabaseBroadcastKey: testServiceKey,
		SupabaseStorageKey:   testServiceKey,
	})

	rec := getRealtimeConfig(t, mux, testPluginToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Access-Control-Allow-Origin = %q, want CORS like sibling plugin routes", got)
	}
	if strings.Contains(rec.Body.String(), testServiceKey) {
		t.Fatalf("response leaked the Supabase service/broadcast key: %s", rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v, body = %s", err, rec.Body.String())
	}
	want := map[string]any{
		"enabled": true,
		"url":     "wss://project-ref.supabase.co/realtime/v1/websocket?apikey=" + testAnonKey + "&vsn=1.0.0",
		"apiKey":  testAnonKey,
		"topic":   "realtime:pos-plugin",
		"events": map[string]any{
			"orderReady":         "order_ready",
			"tableSyncRequested": "table_sync_requested",
		},
		"fallbackPollSeconds": float64(60),
	}
	assertJSONEqual(t, body, want)
}

func TestPOSPluginRealtimeConfig_DisabledWithoutSupabaseRealtimeSettings(t *testing.T) {
	cases := map[string]config.Config{
		"no Supabase URL": {SupabaseAnonKey: testAnonKey, SupabaseBroadcastKey: testServiceKey},
		"no anon key":     {SupabaseURL: "https://project-ref.supabase.co", SupabaseBroadcastKey: testServiceKey},
		// Without the broadcast key laam-api never sends a signal, so the
		// plugin must keep fast polling rather than wait on a silent socket.
		"no broadcast key": {SupabaseURL: "https://project-ref.supabase.co", SupabaseAnonKey: testAnonKey},
	}
	for name, cfg := range cases {
		t.Run(name, func(t *testing.T) {
			cfg.AllowedOrigin = "*"
			cfg.POSPluginAPIToken = testPluginToken
			rec := getRealtimeConfig(t, realtimeConfigMux(cfg), testPluginToken)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), testServiceKey) {
				t.Fatalf("response leaked the Supabase service/broadcast key: %s", rec.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v, body = %s", err, rec.Body.String())
			}
			assertJSONEqual(t, body, map[string]any{"enabled": false, "fallbackPollSeconds": float64(3)})
		})
	}
}

func TestPOSPluginRealtimeConfig_RejectsNonGET(t *testing.T) {
	mux := realtimeConfigMux(config.Config{AllowedOrigin: "*", POSPluginAPIToken: testPluginToken})
	req := httptest.NewRequest(http.MethodPost, realtimeEndpoint, nil)
	req.Header.Set("Authorization", "Bearer "+testPluginToken)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestPOSPluginOrderClaim_ReportsNoPendingTableSyncWhenClaimsDisabled(t *testing.T) {
	mux := realtimeConfigMux(config.Config{
		AllowedOrigin:     "*",
		POSOrderProvider:  "open-api",
		POSPluginAPIToken: testPluginToken,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/pos-plugin/orders/claim", nil)
	req.Header.Set("Authorization", "Bearer "+testPluginToken)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("X-Table-Sync-Pending"); got != "0" {
		t.Errorf("X-Table-Sync-Pending = %q, want %q", got, "0")
	}
	if got := rec.Header().Get("Access-Control-Expose-Headers"); !strings.Contains(got, "X-Table-Sync-Pending") {
		t.Errorf("Access-Control-Expose-Headers = %q, want it to expose X-Table-Sync-Pending", got)
	}
}

func assertJSONEqual(t *testing.T, got, want map[string]any) {
	t.Helper()
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	if string(gotJSON) != string(wantJSON) {
		t.Errorf("body = %s\nwant   %s", gotJSON, wantJSON)
	}
}
