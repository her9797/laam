package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type capturedBroadcast struct {
	Path string
	Body string
}

// fakeBroadcastServer stands in for Supabase's Realtime broadcast REST
// endpoint, the same way the admin-orders/admin-requests router tests do.
func fakeBroadcastServer(t *testing.T) (*httptest.Server, chan capturedBroadcast) {
	t.Helper()
	received := make(chan capturedBroadcast, 16)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- capturedBroadcast{Path: r.URL.Path, Body: string(body)}
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(server.Close)
	return server, received
}

// waitForBroadcast returns the first broadcast sent to path, ignoring
// signals on other channels (e.g. the admin-orders alarm), or fails.
func waitForBroadcast(t *testing.T, received chan capturedBroadcast, path string) capturedBroadcast {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case got := <-received:
			if got.Path == path {
				return got
			}
		case <-deadline:
			t.Fatalf("timed out waiting for a broadcast to %s", path)
			return capturedBroadcast{}
		}
	}
}

func assertNoBroadcast(t *testing.T, received chan capturedBroadcast, path string) {
	t.Helper()
	deadline := time.After(200 * time.Millisecond)
	for {
		select {
		case got := <-received:
			if got.Path == path {
				t.Fatalf("unexpected broadcast to %s", path)
			}
		case <-deadline:
			return
		}
	}
}

const (
	posOrderReadyBroadcastPath     = "/realtime/v1/api/broadcast/pos-plugin/events/order_ready"
	posTableSyncBroadcastPath      = "/realtime/v1/api/broadcast/pos-plugin/events/table_sync_requested"
	posOrderReadyBroadcastBody     = `{"type":"order_ready"}`
	posTableSyncBroadcastBody      = `{"type":"table_sync_requested"}`
	tableSyncPendingHeader         = "X-Table-Sync-Pending"
	pluginRealtimeTestPluginToken  = "plugin-token"
	pluginRealtimeTestBroadcastKey = "test-broadcast-key"
)

func seedPluginRealtimeMenu(t *testing.T) {
	t.Helper()
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO menu_categories (id, label, sort_order) VALUES ('highball', '하이볼', 1);
		INSERT INTO menu_items (id, category_id, name, description, price, sort_order, toss_catalog_item_id)
		VALUES ('house-highball', 'highball', '하우스 하이볼', '테스트 메뉴', '10,000원', 1, '42');
	`); err != nil {
		t.Fatalf("seed menu: %v", err)
	}
}

func TestRouter_PluginOrderCreate_SendsPOSOrderReadyBroadcast(t *testing.T) {
	resetServer(t)
	seedPluginRealtimeMenu(t)
	broadcastServer, received := fakeBroadcastServer(t)

	cfg := testCfg
	cfg.POSOrderProvider = "plugin"
	cfg.POSPluginAPIToken = pluginRealtimeTestPluginToken
	cfg.SupabaseURL = broadcastServer.URL
	cfg.SupabaseBroadcastKey = pluginRealtimeTestBroadcastKey
	handler := NewMux(testRepo, cfg, nil)

	createBody, _ := json.Marshal(map[string]string{"menuItemId": "house-highball", "tableNumber": "T-01"})
	created := doRequest(t, handler, http.MethodPost, "/api/v1/orders", createBody, map[string]string{
		"Authorization": "Bearer " + cfg.PaymentAPIToken,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}

	got := waitForBroadcast(t, received, posOrderReadyBroadcastPath)
	if got.Body != posOrderReadyBroadcastBody {
		t.Errorf("broadcast body = %s, want the content-free %s", got.Body, posOrderReadyBroadcastBody)
	}
}

func TestRouter_PluginPaymentConfirm_SendsPOSOrderReadyBroadcast(t *testing.T) {
	resetServer(t)
	seedPluginRealtimeMenu(t)
	broadcastServer, received := fakeBroadcastServer(t)

	paymentServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			OrderID string `json:"orderId"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		writeJSON(w, http.StatusOK, map[string]any{
			"paymentKey": "pay_test", "orderId": request.OrderID, "status": "DONE",
			"method": "카드", "totalAmount": 10000, "suppliedAmount": 9091, "vat": 909,
			"taxFreeAmount": 0, "approvedAt": "2026-09-05T12:00:00+09:00",
		})
	}))
	defer paymentServer.Close()

	cfg := testCfg
	cfg.POSOrderProvider = "plugin"
	cfg.POSPluginAPIToken = pluginRealtimeTestPluginToken
	cfg.TossPaymentsSecretKey = "secret"
	cfg.TossPaymentsAPIBaseURL = paymentServer.URL
	cfg.SupabaseURL = broadcastServer.URL
	cfg.SupabaseBroadcastKey = pluginRealtimeTestBroadcastKey
	handler := NewMux(testRepo, cfg, nil)
	headers := map[string]string{"Authorization": "Bearer " + cfg.PaymentAPIToken}

	createBody, _ := json.Marshal(map[string]string{"menuItemId": "house-highball", "tableNumber": "T-01"})
	created := doRequest(t, handler, http.MethodPost, "/api/v1/payments/orders", createBody, headers)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}
	var order struct {
		OrderID string `json:"orderId"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &order); err != nil {
		t.Fatalf("decode created order: %v", err)
	}
	// An unpaid payment order is not claimable yet, so the plugin must
	// not be woken for it.
	assertNoBroadcast(t, received, posOrderReadyBroadcastPath)

	confirmBody, _ := json.Marshal(map[string]any{"paymentKey": "pay_test", "orderId": order.OrderID, "amount": 10000})
	confirmed := doRequest(t, handler, http.MethodPost, "/api/v1/payments/confirm", confirmBody, headers)
	if confirmed.Code != http.StatusOK {
		t.Fatalf("confirm status = %d, body = %s", confirmed.Code, confirmed.Body.String())
	}

	got := waitForBroadcast(t, received, posOrderReadyBroadcastPath)
	if got.Body != posOrderReadyBroadcastBody {
		t.Errorf("broadcast body = %s, want the content-free %s", got.Body, posOrderReadyBroadcastBody)
	}
}

func TestRouter_AdminTablePOSSync_SendsPOSTableSyncBroadcast(t *testing.T) {
	broadcastServer, received := fakeBroadcastServer(t)
	cfg := tableLinkConfig()
	cfg.SupabaseURL = broadcastServer.URL
	cfg.SupabaseBroadcastKey = pluginRealtimeTestBroadcastKey
	resetServerWithConfig(t, cfg)
	handler := NewMux(testRepo, cfg, nil)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables/pos-sync", nil, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("pos-sync status = %d, body = %s", rec.Code, rec.Body.String())
	}

	got := waitForBroadcast(t, received, posTableSyncBroadcastPath)
	if got.Body != posTableSyncBroadcastBody {
		t.Errorf("broadcast body = %s, want the content-free %s", got.Body, posTableSyncBroadcastBody)
	}
}

func TestRouter_POSPluginOrderClaim_ReportsPendingTableSync(t *testing.T) {
	handler := tableLinkServer(t)

	claimOrder := func(t *testing.T, wantStatus int, wantPending string) {
		t.Helper()
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/claim", nil, pluginHeaders())
		if rec.Code != wantStatus {
			t.Fatalf("order claim status = %d, want %d, body = %s", rec.Code, wantStatus, rec.Body.String())
		}
		if got := rec.Header().Get(tableSyncPendingHeader); got != wantPending {
			t.Fatalf("%s = %q, want %q", tableSyncPendingHeader, got, wantPending)
		}
	}

	t.Run("no table sync waiting", func(t *testing.T) {
		claimOrder(t, http.StatusNoContent, "0")
	})

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables/pos-sync", nil, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("pos-sync status = %d, body = %s", rec.Code, rec.Body.String())
	}

	t.Run("a waiting table sync is reported on 204", func(t *testing.T) {
		claimOrder(t, http.StatusNoContent, "1")
		// Reporting it must not claim it: the plugin still gets it here.
		claimOrder(t, http.StatusNoContent, "1")
	})

	t.Run("a waiting table sync is reported on 200", func(t *testing.T) {
		if _, err := testPool.Exec(t.Context(), `
			INSERT INTO payment_orders (
				id, toss_catalog_item_id, menu_item_name, category_name, table_number,
				amount, pos_sync_status, pos_claim_ready
			) VALUES ('queued-order', '42', '하우스 하이볼', '하이볼', 'T-01', 10000, 'PENDING', TRUE)
		`); err != nil {
			t.Fatalf("seed queued order: %v", err)
		}
		claimOrder(t, http.StatusOK, "1")
	})

	t.Run("a claimed (running) table sync is no longer waiting", func(t *testing.T) {
		rec := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/claim", nil, pluginHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("table claim status = %d, body = %s", rec.Code, rec.Body.String())
		}
		claimOrder(t, http.StatusNoContent, "0")
	})

	t.Run("a timed-out request is not reported", func(t *testing.T) {
		if _, err := testPool.Exec(t.Context(), `
			INSERT INTO pos_table_sync_requests (id, status, requested_at)
			VALUES ('stale-sync', 'PENDING', NOW() - INTERVAL '5 minutes')
		`); err != nil {
			t.Fatalf("seed stale sync: %v", err)
		}
		claimOrder(t, http.StatusNoContent, "0")
	})
}
