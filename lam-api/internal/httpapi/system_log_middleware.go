package httpapi

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"runtime/debug"
	"strings"

	"github.com/her9797/lam/lam-api/internal/store"
)

// systemLogResponseBodyCaptureLimit bounds how much of a handler's response
// body systemLogMiddleware buffers to look for the {"error": "..."} shape
// writeError produces. It is not a log of the full response — payment
// tokens and other sensitive fields must never reach system_error_logs.
//
// It must always be large enough to hold a full writeError body for the
// longest message RecordSystemErrorLog will ever store: 2000 runes
// (systemErrorLogMessageMaxLen in internal/store/postgres.go), each up to 4
// bytes in UTF-8, plus the `{"error":"..."}\n` JSON wrapper (~13 bytes) that
// encoding/json's Encoder adds. That is 2000*4 + 13 = 8013 bytes in the
// worst case; 8192 rounds that up with headroom for JSON escaping (e.g. a
// message containing many `"` or `\` characters, each escaped to 2 bytes).
// A message longer than this limit (or one escaped heavily enough to still
// exceed it) still gets a partial, truncated message via
// extractPartialErrorMessage below rather than an empty one.
const systemLogResponseBodyCaptureLimit = 8192

var errInternalServerError = errors.New("internal server error")

// systemLogMiddleware wraps the whole mux so that (a) a handler panic is
// recovered instead of crashing the process — this codebase has no other
// recover() — and turned into a generic 500, and (b) every 5xx response,
// panic or not, is recorded to system_error_logs for the admin system-log
// screen. A failure to record is logged and otherwise ignored: it must
// never affect the response already being sent to the original caller.
func systemLogMiddleware(next http.Handler, repository *store.Repository) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rw := &systemLogResponseWriter{ResponseWriter: w}

		defer func() {
			if p := recover(); p != nil {
				log.Printf("panic recovered in %s %s: %v\n%s", r.Method, r.URL.Path, p, debug.Stack())

				recordSystemErrorLog(r, repository, http.StatusInternalServerError, fmt.Sprintf("panic: %v", p))

				if !rw.wroteHeader {
					writeError(rw, http.StatusInternalServerError, errInternalServerError)
				}
			}
		}()

		next.ServeHTTP(rw, r)

		if rw.status >= http.StatusInternalServerError {
			recordSystemErrorLog(r, repository, rw.status, extractWriteErrorMessage(rw.body.Bytes()))
		}
	})
}

// recordSystemErrorLog is best-effort and must never let a problem here
// affect the original response. It also guards its own recover(): some
// tests (and, in principle, some early-init misconfiguration) call NewMux
// with a nil repository, and recording from inside an already-recovered
// panic must not re-panic and crash the process.
func recordSystemErrorLog(r *http.Request, repository *store.Repository, status int, message string) {
	if repository == nil {
		return
	}

	defer func() {
		if p := recover(); p != nil {
			log.Printf("system log: panic while recording error log for %s %s: %v", r.Method, r.URL.Path, p)
		}
	}()

	if err := repository.RecordSystemErrorLog(r.Context(), r.Method, r.URL.Path, status, message); err != nil {
		log.Printf("system log: failed to record error log for %s %s: %v", r.Method, r.URL.Path, err)
	}
}

// extractWriteErrorMessage pulls the "error" field out of a writeError-style
// {"error": "..."} JSON body. Any other shape yields an empty message
// rather than storing the raw body, since it may not be JSON-shaped at all.
// A body that looks like a writeError body but failed to parse (most likely
// truncated by systemLogResponseBodyCaptureLimit) falls back to a
// best-effort partial extraction instead of an empty message.
func extractWriteErrorMessage(body []byte) string {
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err == nil {
		return payload.Error
	}
	return extractPartialErrorMessage(body)
}

// extractPartialErrorMessage recovers as much of the "error" field's value
// as possible from a body that failed to parse as JSON, by scanning for the
// `"error":"` prefix writeError always emits and reading up to the next
// unescaped quote (or to the end of the captured bytes, if the body was cut
// off before the closing quote). It only understands the small set of JSON
// string escapes worth bothering with for a best-effort recovery; a body
// that doesn't match the expected shape at all falls back to "".
func extractPartialErrorMessage(body []byte) string {
	const prefix = `"error":"`
	idx := bytes.Index(body, []byte(prefix))
	if idx == -1 {
		return ""
	}
	rest := body[idx+len(prefix):]

	var sb strings.Builder
	for i := 0; i < len(rest); i++ {
		c := rest[i]
		if c == '"' {
			break
		}
		if c == '\\' && i+1 < len(rest) {
			i++
			switch rest[i] {
			case 'n':
				sb.WriteByte('\n')
			case 't':
				sb.WriteByte('\t')
			default:
				sb.WriteByte(rest[i])
			}
			continue
		}
		sb.WriteByte(c)
	}
	return sb.String()
}

// systemLogResponseWriter records the status code a handler responds with
// and buffers up to systemLogResponseBodyCaptureLimit bytes of the body, so
// systemLogMiddleware can decide, after the handler returns, whether and
// what to log — without altering what is actually sent to the client.
type systemLogResponseWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	body        bytes.Buffer
}

func (w *systemLogResponseWriter) WriteHeader(status int) {
	if !w.wroteHeader {
		w.status = status
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *systemLogResponseWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.status = http.StatusOK
		w.wroteHeader = true
	}
	if remaining := systemLogResponseBodyCaptureLimit - w.body.Len(); remaining > 0 {
		if remaining > len(b) {
			remaining = len(b)
		}
		w.body.Write(b[:remaining])
	}
	return w.ResponseWriter.Write(b)
}

// Flush forwards to the wrapped ResponseWriter's http.Flusher, if it
// implements one, so this wrapper doesn't break streaming handlers that
// rely on flushing partial output (e.g. SSE). A no-op if unsupported,
// matching how http.ResponseWriter callers are expected to check first —
// but a type assertion inside the method is the standard way to expose the
// optional interface through a wrapper without callers needing to unwrap it.
func (w *systemLogResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack forwards to the wrapped ResponseWriter's http.Hijacker, if it
// implements one. Returns an error matching http.ErrNotSupported otherwise,
// per the http.NewResponseController convention for unsupported Hijack.
func (w *systemLogResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hj.Hijack()
}

// Push forwards to the wrapped ResponseWriter's http.Pusher, if it
// implements one. Returns http.ErrNotSupported otherwise, matching the
// http.Pusher documentation for servers that don't support HTTP/2 push.
func (w *systemLogResponseWriter) Push(target string, opts *http.PushOptions) error {
	p, ok := w.ResponseWriter.(http.Pusher)
	if !ok {
		return http.ErrNotSupported
	}
	return p.Push(target, opts)
}
