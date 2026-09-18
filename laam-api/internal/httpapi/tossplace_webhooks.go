package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

const (
	tossPlaceOrderCompletedEventType = "order.order.completed.v1"
	tossPlaceOrderCancelledEventType = "order.order.cancelled.v1"
)

type tossPlaceWebhookEnvelope struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	CreatedAt string          `json:"createdAt"`
	Data      json.RawMessage `json:"data"`
}

type tossPlaceOrderEventData struct {
	OrderID     string `json:"orderId"`
	OrderKey    string `json:"orderKey"`
	OrderNumber string `json:"orderNumber"`
	Source      string `json:"source"`
	CompletedAt string `json:"completedAt"`
	CancelledAt string `json:"cancelledAt"`
}

// registerTossPlaceWebhookRoutes wires the TossPlace order webhook that
// syncs POS-side payment/cancellation events into payment_orders.status
// (see internal/httpapi/tossplace_webhooks.go's handler for the flow). This
// is a server-to-server callback from TossPlace itself, not a browser
// request, so — unlike every other route in this package — it is neither
// wrapped in withCORS nor gated by requireAdminAuth/requirePaymentAuth;
// authentication is the TossPlace signature verified in the handler.
func registerTossPlaceWebhookRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config) {
	posClient := tossplace.NewClient(cfg.TossPlaceAPIBaseURL, cfg.TossPlaceAccessKey, cfg.TossPlaceSecretKey, cfg.TossPlaceMerchantID, nil)

	mux.HandleFunc("/api/v1/webhooks/tossplace/orders", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		rawBody, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("failed to read webhook body"))
			return
		}

		if !verifyTossPlaceWebhookSignature(cfg.TossPlaceWebhookSecret, r.Header.Get("x-toss-timestamp"), r.Header.Get("x-toss-signature"), rawBody) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid webhook signature"})
			return
		}

		var envelope tossPlaceWebhookEnvelope
		if err := json.Unmarshal(rawBody, &envelope); err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid webhook payload"))
			return
		}

		switch envelope.Type {
		case tossPlaceOrderCompletedEventType:
			handleTossPlaceOrderCompleted(r, repository, posClient, envelope)
		case tossPlaceOrderCancelledEventType:
			handleTossPlaceOrderCancelled(r, repository, envelope)
		default:
			// Subscribed event scope is "주문 (v1)" only, but TossPlace may
			// still deliver other order-related event types in the same
			// scope in the future — ignore defensively rather than error,
			// and always ack so this never triggers a retry storm.
			log.Printf("tossplace webhook: ignoring event type %q (id=%s)", envelope.Type, envelope.ID)
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

// verifyTossPlaceWebhookSignature implements TossPlace's documented webhook
// signature scheme (docs.tossplace.com/reference/open-api/webhook.html):
// HMAC-SHA256 over "<x-toss-timestamp>.<rawRequestBody>" using the webhook
// secret, hex-encoded and prefixed with "v1=". rawBody must be the exact
// bytes received on the wire — decoding to JSON and re-serializing before
// verification would not reproduce byte-for-byte input and always fail.
func verifyTossPlaceWebhookSignature(secret string, timestamp string, signature string, rawBody []byte) bool {
	if secret == "" || timestamp == "" || signature == "" {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(rawBody)
	expected := "v1=" + hex.EncodeToString(mac.Sum(nil))

	return subtle.ConstantTimeCompare([]byte(signature), []byte(expected)) == 1
}

func handleTossPlaceOrderCompleted(r *http.Request, repository *store.Repository, posClient *tossplace.Client, envelope tossPlaceWebhookEnvelope) {
	var data tossPlaceOrderEventData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		log.Printf("tossplace webhook: invalid completed-event data (id=%s): %v", envelope.ID, err)
		return
	}

	order, err := repository.GetPaymentOrder(r.Context(), data.OrderKey)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			// Not one of our own orders — most likely rung up directly on
			// the POS, with no lam-web orderKey ever assigned to it. Record
			// it as a new sale rather than dropping it, so it still counts
			// toward revenue reporting (see createPOSNativeOrder).
			createPOSNativeOrder(r.Context(), repository, posClient, data, envelope.ID)
			return
		}
		log.Printf("tossplace webhook: failed to load order %q (id=%s): %v", data.OrderKey, envelope.ID, err)
		return
	}

	vat := order.Amount / 11
	suppliedAmount := order.Amount - vat
	approvedAt := parseTossPlaceWebhookTimestamp(data.CompletedAt)

	if _, err := repository.CompletePaymentOrderFromPOS(r.Context(), data.OrderKey, approvedAt, vat, suppliedAmount, 0); err != nil {
		// ErrInvalidInput means the order was already CANCELLED — never
		// resurrect a cancelled order into DONE, but still ack the webhook
		// so TossPlace does not retry indefinitely.
		log.Printf("tossplace webhook: failed to complete order %q from POS (id=%s): %v", data.OrderKey, envelope.ID, err)
	}
}

// createPOSNativeOrder records a TossPlace order rung up directly on the
// POS (no matching lam-web orderKey) as one payment_orders row per line
// item — the completed-event payload carries no line items itself, so this
// re-fetches the full order via the Open API before recording anything.
//
// Each row's amount is that line item's own priceValue*quantity plus its
// option choices, deliberately not the order's chargePrice.totalAmount
// divided across items: TossPlace does not return a per-line-item share of
// order-level discounts/tax, and approximating one would risk revenue
// figures that don't reconcile against TossPlace's own reports. table_number
// stays "" — TossPlace's Order response does not expose which table a
// POS-native order opened on.
func createPOSNativeOrder(ctx context.Context, repository *store.Repository, posClient *tossplace.Client, data tossPlaceOrderEventData, eventID string) {
	if data.OrderID == "" {
		log.Printf("tossplace webhook: completed event missing orderId for unknown orderKey %q (id=%s)", data.OrderKey, eventID)
		return
	}

	// Idempotency for a retried webhook delivery: skip if this TossPlace
	// order's line items were already recorded.
	exists, err := repository.HasPaymentOrderWithPOSOrderID(ctx, data.OrderID)
	if err != nil {
		log.Printf("tossplace webhook: failed to check existing POS-native order %q (id=%s): %v", data.OrderID, eventID, err)
		return
	}
	if exists {
		return
	}

	order, err := posClient.GetOrder(ctx, data.OrderID)
	if err != nil {
		log.Printf("tossplace webhook: failed to fetch POS-native order %q (id=%s): %v", data.OrderID, eventID, err)
		return
	}
	if len(order.LineItems) == 0 {
		log.Printf("tossplace webhook: POS-native order %q has no line items (id=%s)", data.OrderID, eventID)
		return
	}

	approvedAt := parseTossPlaceWebhookTimestamp(order.CompletedAt)
	for _, line := range order.LineItems {
		amount := line.ItemPrice.PriceValue * line.Quantity
		for _, choice := range line.OptionChoices {
			amount += choice.PriceValue * choice.Quantity
		}
		if amount <= 0 {
			log.Printf("tossplace webhook: skipping non-positive line item amount for POS-native order %q (id=%s)", data.OrderID, eventID)
			continue
		}
		vat := amount / 11
		if _, err := repository.CreatePOSNativeOrder(ctx, store.CreatePOSNativeOrderInput{
			MenuItemName:   line.Item.Title,
			CategoryName:   line.Item.Category.Title,
			Amount:         amount,
			ApprovedAt:     approvedAt,
			VAT:            vat,
			SuppliedAmount: amount - vat,
			POSOrderID:     data.OrderID,
		}); err != nil {
			log.Printf("tossplace webhook: failed to record POS-native line item for order %q (id=%s): %v", data.OrderID, eventID, err)
		}
	}
}

func handleTossPlaceOrderCancelled(r *http.Request, repository *store.Repository, envelope tossPlaceWebhookEnvelope) {
	var data tossPlaceOrderEventData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		log.Printf("tossplace webhook: invalid cancelled-event data (id=%s): %v", envelope.ID, err)
		return
	}

	if _, err := repository.GetPaymentOrder(r.Context(), data.OrderKey); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Printf("tossplace webhook: cancelled event for unknown orderKey %q (id=%s)", data.OrderKey, envelope.ID)
			return
		}
		log.Printf("tossplace webhook: failed to load order %q (id=%s): %v", data.OrderKey, envelope.ID, err)
		return
	}

	cancelledAt := parseTossPlaceWebhookTimestamp(data.CancelledAt)
	if _, err := repository.CancelPaymentOrder(r.Context(), data.OrderKey, cancelledAt); err != nil {
		log.Printf("tossplace webhook: failed to cancel order %q (id=%s): %v", data.OrderKey, envelope.ID, err)
	}
}

// tossPlaceTimestampLayoutWithoutTimezone handles the timezone-less
// timestamp example TossPlace's own docs show for order events (e.g.
// "2025-09-01T00:00:00"), which time.RFC3339 cannot parse.
const tossPlaceTimestampLayoutWithoutTimezone = "2006-01-02T15:04:05"

// parseTossPlaceWebhookTimestamp never fails the webhook over an
// unparseable timestamp: RFC3339 first, then the timezone-less layout seen
// in TossPlace's docs, then time.Now().UTC() as a last-resort fallback
// (logged) so processing the event's status transition is never blocked by
// a timestamp formatting quirk.
func parseTossPlaceWebhookTimestamp(raw string) time.Time {
	if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		return parsed
	}
	if parsed, err := time.Parse(tossPlaceTimestampLayoutWithoutTimezone, raw); err == nil {
		return parsed.UTC()
	}
	log.Printf("tossplace webhook: could not parse timestamp %q, falling back to now", raw)
	return time.Now().UTC()
}
