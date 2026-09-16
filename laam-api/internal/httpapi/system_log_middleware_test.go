package httpapi

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeFlushHijackPushWriter implements http.Flusher, http.Hijacker and
// http.Pusher on top of an httptest.ResponseRecorder so tests can verify
// systemLogResponseWriter forwards to them when the wrapped ResponseWriter
// supports them.
type fakeFlushHijackPushWriter struct {
	*httptest.ResponseRecorder
	flushed    bool
	hijackErr  error
	pushTarget string
	pushErr    error
}

func (f *fakeFlushHijackPushWriter) Flush() {
	f.flushed = true
}

func (f *fakeFlushHijackPushWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, f.hijackErr
}

func (f *fakeFlushHijackPushWriter) Push(target string, opts *http.PushOptions) error {
	f.pushTarget = target
	return f.pushErr
}

func TestSystemLogResponseWriter_ForwardsFlush(t *testing.T) {
	fake := &fakeFlushHijackPushWriter{ResponseRecorder: httptest.NewRecorder()}
	rw := &systemLogResponseWriter{ResponseWriter: fake}

	rw.Flush()

	if !fake.flushed {
		t.Error("expected Flush() to be forwarded to the wrapped ResponseWriter")
	}
}

func TestSystemLogResponseWriter_ForwardsHijack(t *testing.T) {
	wantErr := errors.New("hijack failed")
	fake := &fakeFlushHijackPushWriter{ResponseRecorder: httptest.NewRecorder(), hijackErr: wantErr}
	rw := &systemLogResponseWriter{ResponseWriter: fake}

	_, _, err := rw.Hijack()

	if !errors.Is(err, wantErr) {
		t.Errorf("Hijack() error = %v, want %v", err, wantErr)
	}
}

func TestSystemLogResponseWriter_ForwardsPush(t *testing.T) {
	fake := &fakeFlushHijackPushWriter{ResponseRecorder: httptest.NewRecorder()}
	rw := &systemLogResponseWriter{ResponseWriter: fake}

	if err := rw.Push("/style.css", nil); err != nil {
		t.Fatalf("Push() error = %v, want nil", err)
	}
	if fake.pushTarget != "/style.css" {
		t.Errorf("Push() target = %q, want /style.css", fake.pushTarget)
	}
}

func TestSystemLogResponseWriter_HijackNotSupported(t *testing.T) {
	rw := &systemLogResponseWriter{ResponseWriter: httptest.NewRecorder()}

	_, _, err := rw.Hijack()

	if !errors.Is(err, http.ErrNotSupported) {
		t.Errorf("Hijack() error = %v, want http.ErrNotSupported", err)
	}
}

func TestSystemLogResponseWriter_PushNotSupported(t *testing.T) {
	rw := &systemLogResponseWriter{ResponseWriter: httptest.NewRecorder()}

	err := rw.Push("/style.css", nil)

	if !errors.Is(err, http.ErrNotSupported) {
		t.Errorf("Push() error = %v, want http.ErrNotSupported", err)
	}
}

func TestExtractWriteErrorMessage_ValidJSON(t *testing.T) {
	got := extractWriteErrorMessage([]byte(`{"error":"db unavailable"}` + "\n"))
	if got != "db unavailable" {
		t.Errorf("extractWriteErrorMessage() = %q, want %q", got, "db unavailable")
	}
}

func TestExtractWriteErrorMessage_NotJSON_ReturnsEmpty(t *testing.T) {
	got := extractWriteErrorMessage([]byte("not json at all"))
	if got != "" {
		t.Errorf("extractWriteErrorMessage() = %q, want empty string", got)
	}
}

func TestExtractWriteErrorMessage_TruncatedJSON_RecoversPartialMessage(t *testing.T) {
	// Simulates the body systemLogResponseWriter would have captured if the
	// full writeError JSON body exceeded systemLogResponseBodyCaptureLimit
	// and got cut off mid-string, before the closing quote.
	truncated := []byte(`{"error":"something went wrong while processing the requ`)

	got := extractWriteErrorMessage(truncated)

	want := "something went wrong while processing the requ"
	if got != want {
		t.Errorf("extractWriteErrorMessage() = %q, want %q", got, want)
	}
}

func TestExtractWriteErrorMessage_TruncatedJSONWithoutErrorField_ReturnsEmpty(t *testing.T) {
	got := extractWriteErrorMessage([]byte(`{"something":"else`))
	if got != "" {
		t.Errorf("extractWriteErrorMessage() = %q, want empty string", got)
	}
}
