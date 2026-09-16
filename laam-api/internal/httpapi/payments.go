package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/notify"
	"github.com/her9797/laam/laam-api/internal/payment"
	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

type createPaymentOrderRequest struct {
	MenuItemID    string                         `json:"menuItemId"`
	TableNumber   string                         `json:"tableNumber"`
	RequestNote   string                         `json:"requestNote"`
	OptionChoices []store.OrderOptionChoiceInput `json:"optionChoices"`
}

type confirmPaymentRequest struct {
	PaymentKey string `json:"paymentKey"`
	OrderID    string `json:"orderId"`
	Amount     int64  `json:"amount"`
}

// registerPaymentRoutes takes broadcaster so a completed sale can signal
// the admin web the same way a new customer request does (see
// sendNewOrderBroadcastAsync in router.go). It is safe to pass an
// unconfigured Broadcaster — sending is then a no-op.
func registerPaymentRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config, broadcaster *notify.Broadcaster) {
	paymentClient := payment.NewClient(cfg.TossPaymentsAPIBaseURL, cfg.TossPaymentsSecretKey, nil)
	posClient := tossplace.NewClient(cfg.TossPlaceAPIBaseURL, cfg.TossPlaceAccessKey, cfg.TossPlaceSecretKey, cfg.TossPlaceMerchantID, nil)

	mux.HandleFunc("/api/v1/orders", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requirePaymentAuth(w, r, cfg.PaymentAPIToken) {
			return
		}
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload createPaymentOrderRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid order request"))
			return
		}

		order, err := repository.CreatePaymentOrder(r.Context(), payload.MenuItemID, payload.TableNumber, payload.RequestNote, payload.OptionChoices)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		if cfg.POSOrderProvider == "plugin" {
			if err := repository.MarkPaymentOrderPOSReady(r.Context(), order.OrderID); err != nil {
				writeStoreError(w, err)
				return
			}
		} else {
			order = syncUnpaidOrderToPOS(r, repository, posClient, order)
			if order.POSSyncStatus == "SUCCEEDED" {
				sendNewOrderBroadcastAsync(broadcaster)
			}
		}
		writeJSON(w, http.StatusCreated, order)
	}))

	mux.HandleFunc("/api/v1/payments/orders", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requirePaymentAuth(w, r, cfg.PaymentAPIToken) {
			return
		}
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload createPaymentOrderRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid payment order request"))
			return
		}

		order, err := repository.CreatePaymentOrder(r.Context(), payload.MenuItemID, payload.TableNumber, payload.RequestNote, payload.OptionChoices)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, order)
	}))

	mux.HandleFunc("/api/v1/payments/orders/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requirePaymentAuth(w, r, cfg.PaymentAPIToken) {
			return
		}
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		orderID, ok := parseResourceID(r.URL.Path, "/api/v1/payments/orders/")
		if !ok {
			http.NotFound(w, r)
			return
		}
		order, err := repository.GetPaymentOrder(r.Context(), orderID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, order)
	}))

	mux.HandleFunc("/api/v1/payments/confirm", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requirePaymentAuth(w, r, cfg.PaymentAPIToken) {
			return
		}
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload confirmPaymentRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid payment confirmation request"))
			return
		}
		payload.OrderID = strings.TrimSpace(payload.OrderID)
		payload.PaymentKey = strings.TrimSpace(payload.PaymentKey)
		if payload.OrderID == "" || payload.PaymentKey == "" || payload.Amount <= 0 {
			writeError(w, http.StatusBadRequest, errors.New("invalid payment confirmation request"))
			return
		}

		order, err := repository.GetPaymentOrder(r.Context(), payload.OrderID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		if order.Amount != payload.Amount {
			writeError(w, http.StatusBadRequest, errors.New("payment amount does not match order"))
			return
		}

		if order.Status == "DONE" {
			if order.PaymentKey != payload.PaymentKey {
				writeError(w, http.StatusConflict, errors.New("order is already paid"))
				return
			}
		} else {
			confirmed, confirmErr := paymentClient.Confirm(r.Context(), payment.ConfirmRequest{
				PaymentKey: payload.PaymentKey,
				OrderID:    order.OrderID,
				Amount:     order.Amount,
			})
			if confirmErr != nil {
				log.Printf("payments: confirmation failed for order %s: %v", order.OrderID, confirmErr)
				status := http.StatusBadGateway
				if errors.Is(confirmErr, payment.ErrNotConfigured) {
					status = http.StatusServiceUnavailable
				}
				writeError(w, status, errors.New("payment confirmation failed"))
				return
			}
			if confirmed.OrderID != order.OrderID || confirmed.PaymentKey != payload.PaymentKey || confirmed.TotalAmount != order.Amount || confirmed.Status != "DONE" {
				writeError(w, http.StatusBadGateway, errors.New("invalid payment confirmation response"))
				return
			}
			approvedAt, parseErr := time.Parse(time.RFC3339, confirmed.ApprovedAt)
			if parseErr != nil {
				writeError(w, http.StatusBadGateway, errors.New("invalid payment approval time"))
				return
			}
			order, err = repository.CompletePaymentOrder(r.Context(), order.OrderID, store.CompletePaymentOrderInput{
				PaymentKey:     confirmed.PaymentKey,
				PaymentMethod:  confirmed.Method,
				ApprovedAt:     approvedAt,
				VAT:            confirmed.VAT,
				SuppliedAmount: confirmed.SuppliedAmount,
				TaxFreeAmount:  confirmed.TaxFreeAmount,
			})
			if err != nil {
				writeStoreError(w, err)
				return
			}

			// Only this branch is a newly completed sale. The `order.Status
			// == "DONE"` branch above is an idempotent re-confirmation of a
			// payment that was already recorded (a client retry), so
			// broadcasting there would replay the admin's alarm for a sale
			// they have already been told about.
			sendNewOrderBroadcastAsync(broadcaster)
		}

		if cfg.POSOrderProvider == "plugin" {
			if err := repository.MarkPaymentOrderPOSReady(r.Context(), order.OrderID); err != nil {
				writeStoreError(w, err)
				return
			}
		} else {
			order = syncPaymentOrderToPOS(r, repository, posClient, order)
		}
		writeJSON(w, http.StatusOK, order)
	}))

	registerPOSPluginRoutes(mux, repository, cfg, broadcaster)
}

func requirePaymentAuth(w http.ResponseWriter, r *http.Request, token string) bool {
	actual := []byte(strings.TrimSpace(r.Header.Get("Authorization")))
	expected := []byte("Bearer " + token)
	if len(actual) != len(expected) || subtle.ConstantTimeCompare(actual, expected) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "payment authorization required"})
		return false
	}
	return true
}

func syncPaymentOrderToPOS(r *http.Request, repository *store.Repository, client *tossplace.Client, order store.PaymentOrder) store.PaymentOrder {
	if order.POSSyncStatus == "SUCCEEDED" {
		return order
	}
	approvedAt, err := time.Parse(time.RFC3339, order.ApprovedAt)
	if err != nil {
		log.Printf("payments: invalid stored approval time for order %s", order.OrderID)
		return order
	}

	optionChoices, baseAmount := tossPlaceOptionChoices(order)
	result, err := client.CreatePaidOrder(r.Context(), tossplace.PaidOrder{
		OrderID:           order.OrderID,
		OrderNumber:       paymentOrderNumber(order),
		MenuItemID:        order.MenuItemID,
		TossCatalogItemID: order.TossCatalogItemID,
		MenuItemName:      order.MenuItemName,
		CategoryName:      order.CategoryName,
		TableNumber:       order.TableNumber,
		RequestNote:       order.RequestNote,
		BaseAmount:        baseAmount,
		Amount:            order.Amount,
		OptionChoices:     optionChoices,
		VAT:               order.VAT,
		SuppliedAmount:    order.SuppliedAmount,
		TaxFreeAmount:     order.TaxFreeAmount,
		PaymentKey:        order.PaymentKey,
		ApprovedAt:        approvedAt,
	})
	status := "SUCCEEDED"
	posOrderID := result.OrderID
	syncError := ""
	if err != nil {
		status = "FAILED"
		syncError = "toss place request failed"
		if errors.Is(err, tossplace.ErrNotConfigured) {
			status = "NOT_CONFIGURED"
			syncError = "toss place is not configured"
		}
		log.Printf("payments: POS sync failed for order %s: %v", order.OrderID, err)
	}
	if updateErr := repository.UpdatePaymentOrderPOSSync(r.Context(), order.OrderID, status, posOrderID, syncError); updateErr != nil {
		log.Printf("payments: failed to store POS sync result for order %s: %v", order.OrderID, updateErr)
		return order
	}
	updated, getErr := repository.GetPaymentOrder(r.Context(), order.OrderID)
	if getErr != nil {
		return order
	}
	return updated
}

func syncUnpaidOrderToPOS(r *http.Request, repository *store.Repository, client *tossplace.Client, order store.PaymentOrder) store.PaymentOrder {
	if order.POSSyncStatus == "SUCCEEDED" {
		return order
	}
	openedAt, err := time.Parse(time.RFC3339, order.CreatedAt)
	if err != nil {
		log.Printf("orders: invalid stored creation time for order %s", order.OrderID)
		return order
	}

	optionChoices, baseAmount := tossPlaceOptionChoices(order)
	result, err := client.CreateUnpaidOrder(r.Context(), tossplace.UnpaidOrder{
		OrderID:           order.OrderID,
		OrderNumber:       paymentOrderNumber(order),
		MenuItemID:        order.MenuItemID,
		TossCatalogItemID: order.TossCatalogItemID,
		MenuItemName:      order.MenuItemName,
		CategoryName:      order.CategoryName,
		TableNumber:       order.TableNumber,
		RequestNote:       order.RequestNote,
		BaseAmount:        baseAmount,
		Amount:            order.Amount,
		OptionChoices:     optionChoices,
		OpenedAt:          openedAt,
	})
	status := "SUCCEEDED"
	posOrderID := result.OrderID
	syncError := ""
	if err != nil {
		status = "FAILED"
		syncError = "toss place request failed"
		if errors.Is(err, tossplace.ErrNotConfigured) {
			status = "NOT_CONFIGURED"
			syncError = "toss place is not configured"
		}
		log.Printf("orders: POS sync failed for order %s: %v", order.OrderID, err)
	}
	if updateErr := repository.UpdatePaymentOrderPOSSync(r.Context(), order.OrderID, status, posOrderID, syncError); updateErr != nil {
		log.Printf("orders: failed to store POS sync result for order %s: %v", order.OrderID, updateErr)
		return order
	}
	updated, getErr := repository.GetPaymentOrder(r.Context(), order.OrderID)
	if getErr != nil {
		return order
	}
	return updated
}

func tossPlaceOptionChoices(order store.PaymentOrder) ([]tossplace.OrderOptionChoice, int64) {
	choices := make([]tossplace.OrderOptionChoice, 0, len(order.OptionChoices))
	baseAmount := order.Amount
	for _, choice := range order.OptionChoices {
		choices = append(choices, tossplace.OrderOptionChoice{
			OptionID: choice.OptionID, OptionChoiceID: choice.OptionChoiceID,
			Title: choice.ChoiceTitle, Price: choice.PriceValue, Quantity: choice.Quantity,
		})
		baseAmount -= choice.PriceValue * choice.Quantity
	}
	return choices, baseAmount
}

func paymentOrderNumber(order store.PaymentOrder) string {
	suffix := order.OrderID
	if len(suffix) > 12 {
		suffix = suffix[len(suffix)-12:]
	}
	prefix := "lam 웹"
	if strings.TrimSpace(order.TableNumber) != "" {
		prefix = "테이블 " + strings.TrimSpace(order.TableNumber)
	}
	return prefix + " · " + suffix
}
