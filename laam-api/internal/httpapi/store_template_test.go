package httpapi

import (
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
)

func TestSignTemplatePreview(t *testing.T) {
	const secret = "test-qr-signing-secret"

	// Expected value computed independently:
	// printf 'preview:notebook:1700001800' | openssl dgst -sha256 -hmac 'test-qr-signing-secret' -hex
	const want = "d52963a918cd852f6247b4690393ccefa481b565d52fdb71150b4333ef97dda8"
	got := signTemplatePreview(secret, "notebook", "1700001800")
	if got != want {
		t.Fatalf("signTemplatePreview() = %q, want %q", got, want)
	}

	// The "preview:" prefix keeps a preview signature from ever matching a
	// table QR signature over the same value.
	for _, raw := range []string{"notebook", "notebook:1700001800"} {
		if got == signQrTable(secret, raw) {
			t.Errorf("preview signature equals signQrTable(%q)", raw)
		}
	}
}

func TestTemplatePreviewURL(t *testing.T) {
	cfg := config.Config{QRSigningSecret: "test-qr-signing-secret", CustomerWebBaseURL: "https://example.test"}
	now := time.Unix(1700000000, 0)

	got := templatePreviewURL(cfg, "notebook", now)

	want := "https://example.test/preview/enter?template=notebook&exp=1700001800&sig=d52963a918cd852f6247b4690393ccefa481b565d52fdb71150b4333ef97dda8"
	if got != want {
		t.Fatalf("templatePreviewURL() =\n%q\nwant\n%q", got, want)
	}
}
