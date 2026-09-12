package httpapi

import (
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

	"github.com/her9797/lam/lam-api/internal/config"
	"github.com/her9797/lam/lam-api/internal/store"
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
			handleTossPlaceOrderCompleted(r, repository, envelope)
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

func handleTossPlaceOrderCompleted(r *http.Request, repository *store.Repository, envelope tossPlaceWebhookEnvelope) {
	var data tossPlaceOrderEventData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		log.Printf("tossplace webhook: invalid completed-event data (id=%s): %v", envelope.ID, err)
		return
	}

	order, err := repository.GetPaymentOrder(r.Context(), data.OrderKey)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Printf("tossplace webhook: completed event for unknown orderKey %q (id=%s)", data.OrderKey, envelope.ID)
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
