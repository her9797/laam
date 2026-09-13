package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestRouter_PaymentFlowUsesStoredAmountAndSyncsPOS(t *testing.T) {
	resetServer(t)
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO menu_categories (id, label, sort_order) VALUES ('highball', '하이볼', 1);
		INSERT INTO menu_items (id, category_id, name, description, price, sort_order, toss_catalog_item_id)
		VALUES ('house-highball', 'highball', '하우스 하이볼', '테스트 메뉴', '10,000원', 1, 'pos-item-1');
	`); err != nil {
		t.Fatalf("seed menu: %v", err)
	}

	var paymentCalls atomic.Int32
	paymentServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paymentCalls.Add(1)
		if r.URL.Path != "/v1/payments/confirm" {
			t.Errorf("payment path = %q", r.URL.Path)
		}
		var request struct {
			OrderID string `json:"orderId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode payment request: %v", err)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"paymentKey":     "pay_test",
			"orderId":        request.OrderID,
			"status":         "DONE",
			"method":         "카드",
			"totalAmount":    10000,
			"suppliedAmount": 9091,
			"vat":            909,
			"taxFreeAmount":  0,
			"approvedAt":     "2026-09-05T12:00:00+09:00",
		})
	}))
	defer paymentServer.Close()

	var posCalls atomic.Int32
	posServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posCalls.Add(1)
		if got := r.Header.Get("x-access-key"); got != "access" {
			t.Errorf("x-access-key = %q", got)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"resultType": "SUCCESS",
			"success":    map[string]string{"id": "pos-order-1"},
		})
	}))
	defer posServer.Close()

	cfg := testCfg
	cfg.TossPaymentsSecretKey = "secret"
	cfg.TossPaymentsAPIBaseURL = paymentServer.URL
	cfg.TossPlaceAccessKey = "access"
	cfg.TossPlaceSecretKey = "place-secret"
	cfg.TossPlaceMerchantID = "merchant"
	cfg.TossPlaceAPIBaseURL = posServer.URL
	handler := NewMux(testRepo, cfg, nil)
	headers := map[string]string{"Authorization": "Bearer " + cfg.PaymentAPIToken}

	createBody, _ := json.Marshal(map[string]string{"menuItemId": "house-highball", "tableNumber": "7"})
	unauthorized := doRequest(t, handler, http.MethodPost, "/api/v1/payments/orders", createBody, nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized create status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}

	created := doRequest(t, handler, http.MethodPost, "/api/v1/payments/orders", createBody, headers)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}
	var order struct {
		OrderID string `json:"orderId"`
		Amount  int64  `json:"amount"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &order); err != nil {
		t.Fatalf("decode created order: %v", err)
	}
	if order.Amount != 10000 {
		t.Fatalf("amount = %d, want 10000", order.Amount)
	}

	wrongBody, _ := json.Marshal(map[string]any{"paymentKey": "pay_test", "orderId": order.OrderID, "amount": 1})
	wrong := doRequest(t, handler, http.MethodPost, "/api/v1/payments/confirm", wrongBody, headers)
	if wrong.Code != http.StatusBadRequest || paymentCalls.Load() != 0 {
		t.Fatalf("wrong amount status = %d, provider calls = %d", wrong.Code, paymentCalls.Load())
	}

	confirmBody, _ := json.Marshal(map[string]any{"paymentKey": "pay_test", "orderId": order.OrderID, "amount": 10000})
	confirmed := doRequest(t, handler, http.MethodPost, "/api/v1/payments/confirm", confirmBody, headers)
	if confirmed.Code != http.StatusOK {
		t.Fatalf("confirm status = %d, body = %s", confirmed.Code, confirmed.Body.String())
	}
	var result struct {
		Status        string `json:"status"`
		POSSyncStatus string `json:"posSyncStatus"`
		POSOrderID    string `json:"posOrderId"`
	}
	if err := json.Unmarshal(confirmed.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode confirmed order: %v", err)
	}
	if result.Status != "DONE" || result.POSSyncStatus != "SUCCEEDED" || result.POSOrderID != "pos-order-1" {
		t.Fatalf("confirmed order = %+v", result)
	}
	if paymentCalls.Load() != 1 || posCalls.Load() != 1 {
		t.Fatalf("provider calls payment=%d pos=%d, want 1 each", paymentCalls.Load(), posCalls.Load())
	}
}

func TestRouter_OrderOnlyFlowCreatesUnpaidPOSOrder(t *testing.T) {
	resetServer(t)
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO menu_categories (id, label, sort_order) VALUES ('highball', '하이볼', 1);
		INSERT INTO menu_items (id, category_id, name, description, price, sort_order, toss_catalog_item_id)
		VALUES ('house-highball', 'highball', '하우스 하이볼', '테스트 메뉴', '10,000원', 1, 'pos-item-1');
		INSERT INTO menu_options (id, title, is_enabled, is_required, min_choices, max_choices, sort_order)
		VALUES ('option-shot', '샷', TRUE, TRUE, 1, 1, 1);
		INSERT INTO menu_option_choices (id, option_id, title, price_value, is_enabled, state, quantity_enabled, min_quantity, max_quantity, sort_order)
		VALUES ('choice-shot', 'option-shot', '샷 추가', 500, TRUE, 'ON_SALE', FALSE, 1, 1, 1);
		INSERT INTO menu_item_options (menu_item_id, option_id, sort_order)
		VALUES ('house-highball', 'option-shot', 1);
	`); err != nil {
		t.Fatalf("seed menu: %v", err)
	}

	var posCalls atomic.Int32
	posServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posCalls.Add(1)
		var body struct {
			Payments []json.RawMessage `json:"payments"`
			Order    struct {
				OrderKey  string `json:"orderKey"`
				Memo      string `json:"memo"`
				LineItems []struct {
					OptionChoices []struct {
						OptionID       string `json:"optionId"`
						OptionChoiceID string `json:"optionChoiceId"`
						Price          int64  `json:"price"`
					} `json:"optionChoices"`
				} `json:"lineItems"`
			} `json:"order"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode POS order: %v", err)
		}
		if body.Payments == nil || len(body.Payments) != 0 {
			t.Fatalf("payments = %#v, want empty", body.Payments)
		}
		if body.Order.OrderKey == "" {
			t.Fatal("orderKey is empty")
		}
		if body.Order.Memo != "테이블 7 · 요청사항: 얼음 적게 · lam 웹 주문" {
			t.Fatalf("memo = %q", body.Order.Memo)
		}
		if len(body.Order.LineItems) != 1 || len(body.Order.LineItems[0].OptionChoices) != 1 || body.Order.LineItems[0].OptionChoices[0].OptionChoiceID != "choice-shot" || body.Order.LineItems[0].OptionChoices[0].Price != 500 {
			t.Fatalf("POS option choices = %+v", body.Order.LineItems)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"resultType": "SUCCESS",
			"success":    map[string]string{"id": "pos-order-unpaid"},
		})
	}))
	defer posServer.Close()

	cfg := testCfg
	cfg.TossPlaceAccessKey = "access"
	cfg.TossPlaceSecretKey = "place-secret"
	cfg.TossPlaceMerchantID = "merchant"
	cfg.TossPlaceAPIBaseURL = posServer.URL
	handler := NewMux(testRepo, cfg, nil)
	headers := map[string]string{"Authorization": "Bearer " + cfg.PaymentAPIToken}

	createBody, _ := json.Marshal(map[string]any{
		"menuItemId": "house-highball", "tableNumber": "7", "requestNote": "  얼음 적게  ",
		"optionChoices": []map[string]any{{"optionId": "option-shot", "optionChoiceId": "choice-shot", "quantity": 1}},
	})
	created := doRequest(t, handler, http.MethodPost, "/api/v1/orders", createBody, headers)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}
	var result struct {
		Status        string `json:"status"`
		RequestNote   string `json:"requestNote"`
		POSSyncStatus string `json:"posSyncStatus"`
		POSOrderID    string `json:"posOrderId"`
		Amount        int64  `json:"amount"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode order: %v", err)
	}
	if result.Status != "READY" || result.RequestNote != "얼음 적게" || result.Amount != 10500 || result.POSSyncStatus != "SUCCEEDED" || result.POSOrderID != "pos-order-unpaid" {
		t.Fatalf("created order = %+v", result)
	}
	if posCalls.Load() != 1 {
		t.Fatalf("POS calls = %d, want 1", posCalls.Load())
	}
}

func TestRouter_PluginOrderFlowClaimsAndCompletesTableOrder(t *testing.T) {
	resetServer(t)
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO menu_categories (id, label, sort_order) VALUES ('highball', '하이볼', 1);
		INSERT INTO menu_items (id, category_id, name, description, price, sort_order, toss_catalog_item_id)
		VALUES ('house-highball', 'highball', '하우스 하이볼', '테스트 메뉴', '10,000원', 1, '42');
		INSERT INTO menu_options (id, title, is_enabled, is_required, min_choices, max_choices, sort_order)
		VALUES ('7', '샷', TRUE, FALSE, 0, 1, 1);
		INSERT INTO menu_option_choices (id, option_id, title, price_value, is_enabled, state, quantity_enabled, min_quantity, max_quantity, sort_order)
		VALUES ('9', '7', '샷 추가', 500, TRUE, 'ON_SALE', FALSE, 1, 1, 1);
		INSERT INTO menu_item_options (menu_item_id, option_id, sort_order)
		VALUES ('house-highball', '7', 1);
	`); err != nil {
		t.Fatalf("seed menu: %v", err)
	}

	var openAPICalls atomic.Int32
	openAPIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		openAPICalls.Add(1)
		writeJSON(w, http.StatusOK, map[string]any{
			"resultType": "SUCCESS",
			"success":    map[string]string{"id": "must-not-be-called"},
		})
	}))
	defer openAPIServer.Close()

	cfg := testCfg
	cfg.TossPlaceAccessKey = "access"
	cfg.TossPlaceSecretKey = "place-secret"
	cfg.TossPlaceMerchantID = "merchant"
	cfg.TossPlaceAPIBaseURL = openAPIServer.URL
	cfg.POSOrderProvider = "plugin"
	cfg.POSPluginAPIToken = "plugin-token"
	handler := NewMux(testRepo, cfg, nil)

	createBody, _ := json.Marshal(map[string]any{
		"menuItemId": "house-highball", "tableNumber": "T-01", "requestNote": "얼음 적게",
		"optionChoices": []map[string]any{{"optionId": "7", "optionChoiceId": "9", "quantity": 1}},
	})
	created := doRequest(t, handler, http.MethodPost, "/api/v1/orders", createBody, map[string]string{
		"Authorization": "Bearer " + cfg.PaymentAPIToken,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}
	var createdOrder struct {
		OrderID       string `json:"orderId"`
		POSSyncStatus string `json:"posSyncStatus"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createdOrder); err != nil {
		t.Fatalf("decode created order: %v", err)
	}
	if createdOrder.POSSyncStatus != "PENDING" || openAPICalls.Load() != 0 {
		t.Fatalf("created order = %+v, Open API calls = %d", createdOrder, openAPICalls.Load())
	}

	unauthorized := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/claim", nil, nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized claim status = %d", unauthorized.Code)
	}

	pluginHeaders := map[string]string{"Authorization": "Bearer " + cfg.POSPluginAPIToken}
	claimed := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/claim", nil, pluginHeaders)
	if claimed.Code != http.StatusOK {
		t.Fatalf("claim status = %d, body = %s", claimed.Code, claimed.Body.String())
	}
	var claim struct {
		ClaimToken string `json:"claimToken"`
		Order      struct {
			OrderID       string `json:"orderId"`
			TableNumber   string `json:"tableNumber"`
			CatalogItemID string `json:"catalogItemId"`
			Amount        int64  `json:"amount"`
			BaseAmount    int64  `json:"baseAmount"`
			OptionChoices []struct {
				OptionID       string `json:"optionId"`
				OptionChoiceID string `json:"optionChoiceId"`
				Quantity       int64  `json:"quantity"`
			} `json:"optionChoices"`
		} `json:"order"`
	}
	if err := json.Unmarshal(claimed.Body.Bytes(), &claim); err != nil {
		t.Fatalf("decode claim: %v", err)
	}
	if claim.ClaimToken == "" || claim.Order.OrderID != createdOrder.OrderID || claim.Order.TableNumber != "T-01" || claim.Order.CatalogItemID != "42" {
		t.Fatalf("claim = %+v", claim)
	}
	if claim.Order.Amount != 10500 || claim.Order.BaseAmount != 10000 || len(claim.Order.OptionChoices) != 1 || claim.Order.OptionChoices[0].OptionID != "7" || claim.Order.OptionChoices[0].OptionChoiceID != "9" || claim.Order.OptionChoices[0].Quantity != 1 {
		t.Fatalf("claimed order payload = %+v", claim.Order)
	}

	secondClaim := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/claim", nil, pluginHeaders)
	if secondClaim.Code != http.StatusNoContent {
		t.Fatalf("second claim status = %d, body = %s", secondClaim.Code, secondClaim.Body.String())
	}

	completeBody, _ := json.Marshal(map[string]string{
		"claimToken": claim.ClaimToken,
		"posOrderId": "pos-table-order-1",
	})
	wrongCompleteBody, _ := json.Marshal(map[string]string{
		"claimToken": "wrong-claim-token",
		"posOrderId": "pos-table-order-1",
	})
	wrongComplete := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/"+createdOrder.OrderID+"/complete", wrongCompleteBody, pluginHeaders)
	if wrongComplete.Code != http.StatusBadRequest {
		t.Fatalf("wrong claim completion status = %d, body = %s", wrongComplete.Code, wrongComplete.Body.String())
	}
	completed := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/"+createdOrder.OrderID+"/complete", completeBody, pluginHeaders)
	if completed.Code != http.StatusOK {
		t.Fatalf("complete status = %d, body = %s", completed.Code, completed.Body.String())
	}
	stored, err := testRepo.GetPaymentOrder(t.Context(), createdOrder.OrderID)
	if err != nil {
		t.Fatalf("get completed order: %v", err)
	}
	if stored.POSSyncStatus != "SUCCEEDED" || stored.POSOrderID != "pos-table-order-1" {
		t.Fatalf("stored order = %+v", stored)
	}

	createdAgain := doRequest(t, handler, http.MethodPost, "/api/v1/orders", createBody, map[string]string{
		"Authorization": "Bearer " + cfg.PaymentAPIToken,
	})
	if createdAgain.Code != http.StatusCreated {
		t.Fatalf("second create status = %d, body = %s", createdAgain.Code, createdAgain.Body.String())
	}
	claimedAgain := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/claim", nil, pluginHeaders)
	if claimedAgain.Code != http.StatusOK {
		t.Fatalf("second order claim status = %d, body = %s", claimedAgain.Code, claimedAgain.Body.String())
	}
	var retryClaim struct {
		ClaimToken string `json:"claimToken"`
		Order      struct {
			OrderID string `json:"orderId"`
		} `json:"order"`
	}
	if err := json.Unmarshal(claimedAgain.Body.Bytes(), &retryClaim); err != nil {
		t.Fatalf("decode second claim: %v", err)
	}
	failBody, _ := json.Marshal(map[string]string{
		"claimToken": retryClaim.ClaimToken,
		"error":      "POS table not found",
	})
	failed := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/"+retryClaim.Order.OrderID+"/fail", failBody, pluginHeaders)
	if failed.Code != http.StatusOK {
		t.Fatalf("fail status = %d, body = %s", failed.Code, failed.Body.String())
	}
	backedOff := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/claim", nil, pluginHeaders)
	if backedOff.Code != http.StatusNoContent {
		t.Fatalf("backoff claim status = %d, body = %s", backedOff.Code, backedOff.Body.String())
	}
	failedOrder, err := testRepo.GetPaymentOrder(t.Context(), retryClaim.Order.OrderID)
	if err != nil {
		t.Fatalf("get failed order: %v", err)
	}
	if failedOrder.POSSyncStatus != "PENDING" || failedOrder.POSSyncError != "POS table not found" {
		t.Fatalf("failed order = %+v", failedOrder)
	}
}

func TestRouter_OpenAPIProviderDoesNotLeaseQueuedPluginOrders(t *testing.T) {
	resetServer(t)
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO payment_orders (
			id, toss_catalog_item_id, menu_item_name, category_name, table_number,
			amount, pos_sync_status, pos_claim_ready
		) VALUES ('queued-order', '42', '하우스 하이볼', '하이볼', 'T-01', 10000, 'PENDING', TRUE)
	`); err != nil {
		t.Fatalf("seed queued order: %v", err)
	}

	cfg := testCfg
	cfg.POSOrderProvider = "open-api"
	cfg.POSPluginAPIToken = "plugin-token"
	handler := NewMux(testRepo, cfg, nil)
	claimed := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/orders/claim", nil, map[string]string{
		"Authorization": "Bearer " + cfg.POSPluginAPIToken,
	})

	if claimed.Code != http.StatusNoContent {
		t.Fatalf("claim status = %d, body = %s", claimed.Code, claimed.Body.String())
	}
	stored, err := testRepo.GetPaymentOrder(t.Context(), "queued-order")
	if err != nil {
		t.Fatalf("get queued order: %v", err)
	}
	if stored.POSSyncStatus != "PENDING" {
		t.Fatalf("POS sync status = %q, want PENDING", stored.POSSyncStatus)
	}
}

// TestRouter_PaymentConfirm_SendsNewOrderBroadcast wires the router to a
// fake Supabase broadcast endpoint (resetServer's shared testCfg leaves
// Supabase unconfigured on purpose, so every other payment test exercises
// the "disabled" no-op path), mirroring
// TestRouter_CustomerRequests_SendsBroadcastOnCreate.
func TestRouter_PaymentConfirm_SendsNewOrderBroadcast(t *testing.T) {
	resetServer(t) // truncates tables; its returned handler isn't used here
	if _, err := testPool.Exec(t.Context(), `
		INSERT INTO menu_categories (id, label, sort_order) VALUES ('highball', '하이볼', 1);
		INSERT INTO menu_items (id, category_id, name, description, price, sort_order, toss_catalog_item_id)
		VALUES ('house-highball', 'highball', '하우스 하이볼', '테스트 메뉴', '10,000원', 1, 'pos-item-1');
	`); err != nil {
		t.Fatalf("seed menu: %v", err)
	}

	paymentServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			OrderID string `json:"orderId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode payment request: %v", err)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"paymentKey":     "pay_test",
			"orderId":        request.OrderID,
			"status":         "DONE",
			"method":         "카드",
			"totalAmount":    10000,
			"suppliedAmount": 9091,
			"vat":            909,
			"taxFreeAmount":  0,
			"approvedAt":     "2026-09-05T12:00:00+09:00",
		})
	}))
	defer paymentServer.Close()

	received := make(chan string, 4)
	broadcastServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received <- r.URL.Path
		w.WriteHeader(http.StatusAccepted)
	}))
	defer broadcastServer.Close()

	cfg := testCfg
	cfg.TossPaymentsSecretKey = "secret"
	cfg.TossPaymentsAPIBaseURL = paymentServer.URL
	cfg.SupabaseURL = broadcastServer.URL
	cfg.SupabaseBroadcastKey = "test-broadcast-key"
	handler := NewMux(testRepo, cfg, nil)
	headers := map[string]string{"Authorization": "Bearer " + cfg.PaymentAPIToken}

	createBody, _ := json.Marshal(map[string]string{"menuItemId": "house-highball", "tableNumber": "7"})
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

	select {
	case path := <-received:
		t.Fatalf("unexpected broadcast for a not-yet-paid order: %q", path)
	case <-time.After(200 * time.Millisecond):
		// expected: creating a READY order is not a completed sale
	}

	confirmBody, _ := json.Marshal(map[string]any{"paymentKey": "pay_test", "orderId": order.OrderID, "amount": 10000})

	t.Run("completing the payment sends a broadcast", func(t *testing.T) {
		confirmed := doRequest(t, handler, http.MethodPost, "/api/v1/payments/confirm", confirmBody, headers)
		if confirmed.Code != http.StatusOK {
			t.Fatalf("confirm status = %d, body = %s", confirmed.Code, confirmed.Body.String())
		}

		select {
		case path := <-received:
			if path != "/realtime/v1/api/broadcast/admin-orders/events/new_order" {
				t.Errorf("broadcast path = %q, want the admin-orders/new_order path", path)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for the new-order broadcast")
		}
	})

	t.Run("re-confirming an already completed order does not send another broadcast", func(t *testing.T) {
		again := doRequest(t, handler, http.MethodPost, "/api/v1/payments/confirm", confirmBody, headers)
		if again.Code != http.StatusOK {
			t.Fatalf("re-confirm status = %d, body = %s", again.Code, again.Body.String())
		}

		select {
		case path := <-received:
			t.Fatalf("unexpected repeat broadcast on an idempotent re-confirm: %q", path)
		case <-time.After(200 * time.Millisecond):
			// expected: the alarm fires once per completed sale
		}
	})
}
