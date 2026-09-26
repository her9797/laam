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
	"github.com/her9797/laam/laam-api/internal/possync"
	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

const (
	tossPlaceOrderCompletedEventType   = "order.order.completed.v1"
	tossPlaceOrderCancelledEventType   = "order.order.cancelled.v1"
	tossPlacePaymentApprovedEventType  = "payment.payment.approved.v1"
	tossPlacePaymentCancelledEventType = "payment.payment.cancelled.v1"

	// tossPlacePaymentRetryLimit/-Timeout bound the payment re-fetch that
	// piggybacks on every webhook (see possync.Syncer.RetryMissingPayments)
	// so it can never hold a delivery long enough for TossPlace to retry it.
	tossPlacePaymentRetryLimit   = 3
	tossPlacePaymentRetryTimeout = 5 * time.Second
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

type tossPlacePaymentEventData struct {
	Payment tossplace.Payment `json:"payment"`
}

// registerTossPlaceWebhookRoutes wires TossPlace's order ("주문 (v1)") and
// payment ("결제 (v1)") webhooks, which keep payment_orders, pos_bills and
// pos_payments in step with the POS (see internal/possync). These are
// server-to-server callbacks from TossPlace itself, not browser requests,
// so — unlike every other route in this package — they are neither wrapped
// in withCORS nor gated by requireAdminAuth/requirePaymentAuth;
// authentication is the TossPlace signature verified in the handler.
//
// Both paths accept every event type, so either subscription can point at
// either URL.
func registerTossPlaceWebhookRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config) {
	posClient := tossplace.NewClient(cfg.TossPlaceAPIBaseURL, cfg.TossPlaceAccessKey, cfg.TossPlaceSecretKey, cfg.TossPlaceMerchantID, nil)
	handler := tossPlaceWebhookHandler(possync.New(repository, posClient), cfg.TossPlaceWebhookSecret)
	mux.HandleFunc("/api/v1/webhooks/tossplace/orders", handler)
	mux.HandleFunc("/api/v1/webhooks/tossplace/payments", handler)
}

func tossPlaceWebhookHandler(syncer *possync.Syncer, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		rawBody, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("failed to read webhook body"))
			return
		}

		if !verifyTossPlaceWebhookSignature(secret, r.Header.Get("x-toss-timestamp"), r.Header.Get("x-toss-signature"), rawBody) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid webhook signature"})
			return
		}

		var envelope tossPlaceWebhookEnvelope
		if err := json.Unmarshal(rawBody, &envelope); err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid webhook payload"))
			return
		}

		// Processing failures are logged and still acked: TossPlace
		// retrying a delivery we cannot apply would only become a retry
		// storm, and bills missing payments are re-fetched below anyway.
		switch envelope.Type {
		case tossPlaceOrderCompletedEventType:
			handleTossPlaceOrderCompleted(r.Context(), syncer, envelope)
		case tossPlaceOrderCancelledEventType:
			handleTossPlaceOrderCancelled(r.Context(), syncer, envelope)
		case tossPlacePaymentApprovedEventType, tossPlacePaymentCancelledEventType:
			handleTossPlacePaymentEvent(r.Context(), syncer, envelope)
		default:
			// Other event types in the subscribed scopes are ignored
			// defensively rather than erroring.
			log.Printf("tossplace webhook: ignoring event type %q (id=%s)", envelope.Type, envelope.ID)
		}

		retryCtx, cancel := context.WithTimeout(r.Context(), tossPlacePaymentRetryTimeout)
		syncer.RetryMissingPayments(retryCtx, tossPlacePaymentRetryLimit)
		cancel()

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
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

func handleTossPlaceOrderCompleted(ctx context.Context, syncer *possync.Syncer, envelope tossPlaceWebhookEnvelope) {
	var data tossPlaceOrderEventData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		log.Printf("tossplace webhook: invalid completed-event data (id=%s): %v", envelope.ID, err)
		return
	}
	completedAt := parseTossPlaceWebhookTimestamp(data.CompletedAt)
	if err := syncer.CompleteOrder(ctx, data.OrderID, data.OrderKey, completedAt); err != nil {
		log.Printf("tossplace webhook: completed event for order %q (key %q, id=%s) not fully applied: %v", data.OrderID, data.OrderKey, envelope.ID, err)
	}
}

func handleTossPlaceOrderCancelled(ctx context.Context, syncer *possync.Syncer, envelope tossPlaceWebhookEnvelope) {
	var data tossPlaceOrderEventData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		log.Printf("tossplace webhook: invalid cancelled-event data (id=%s): %v", envelope.ID, err)
		return
	}
	cancelledAt := parseTossPlaceWebhookTimestamp(data.CancelledAt)
	if err := syncer.CancelOrder(ctx, data.OrderID, data.OrderKey, cancelledAt); err != nil {
		log.Printf("tossplace webhook: cancelled event for order %q (key %q, id=%s) not applied: %v", data.OrderID, data.OrderKey, envelope.ID, err)
	}
}

// handleTossPlacePaymentEvent stores the payment carried in the event. The
// log line deliberately names only ids, state, source type and amount (no
// card or account details) — enough to see in production how TossPlace
// models partial cancellations, which its docs do not describe.
func handleTossPlacePaymentEvent(ctx context.Context, syncer *possync.Syncer, envelope tossPlaceWebhookEnvelope) {
	var data tossPlacePaymentEventData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		log.Printf("tossplace webhook: invalid payment-event data (id=%s): %v", envelope.ID, err)
		return
	}
	payment := data.Payment
	log.Printf("tossplace webhook: %s id=%s payment=%s order=%s state=%s source=%s amount=%d",
		envelope.Type, envelope.ID, payment.ID, payment.OrderID, payment.State, payment.SourceType, payment.Amount)
	if err := syncer.RecordPayment(ctx, payment); err != nil {
		log.Printf("tossplace webhook: payment %q for order %q (id=%s) not recorded: %v", payment.ID, payment.OrderID, envelope.ID, err)
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
