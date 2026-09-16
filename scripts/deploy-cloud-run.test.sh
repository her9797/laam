#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMP="$(mktemp -d)"
trap 'rm -r "$TEST_TMP"' EXIT

GCLOUD_LOG="$TEST_TMP/gcloud.log"
CURL_LOG="$TEST_TMP/curl.log"
export GCLOUD_LOG CURL_LOG

cat >"$TEST_TMP/gcloud" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$GCLOUD_LOG"

case "$*" in
  "secrets describe laam-youtube-api-key "*)
    if [[ "${MOCK_MISSING_YOUTUBE_SECRET:-}" = "1" ]]; then
      exit 1
    fi
    ;;
  "secrets describe laam-pos-plugin-api-token "*)
    if [[ "${MOCK_MISSING_POS_PLUGIN_SECRET:-}" = "1" ]]; then
      exit 1
    fi
    ;;
  "run services describe laam-api "*)
    printf '%s\n' 'https://laam-api.example.run.app'
    ;;
  "run services describe laam-web "*)
    printf '%s\n' 'https://laam-web.example.run.app'
    ;;
  "run services describe laam-admin-web "*)
    printf '%s\n' 'https://laam-admin-web.example.run.app'
    ;;
  "auth print-access-token")
    printf '%s\n' 'test-access-token'
    ;;
esac
MOCK
chmod +x "$TEST_TMP/gcloud"

cat >"$TEST_TMP/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$CURL_LOG"
printf '%s\n%s' '{"spec":{"routeName":"laam-web"}}' '200'
MOCK
chmod +x "$TEST_TMP/curl"

PATH="$TEST_TMP:$PATH" bash "$ROOT_DIR/scripts/deploy-cloud-run.sh" web >/dev/null

grep -Fq 'run deploy laam-web' "$GCLOUD_LOG"
grep -Fq -- '--region=asia-northeast1' "$GCLOUD_LOG"
grep -Fq -- '--service-account=lam-cloud-run@lam-production.iam.gserviceaccount.com' "$GCLOUD_LOG"
grep -Fq 'auth print-access-token' "$GCLOUD_LOG"
grep -Fq 'https://asia-northeast1-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/lam-production/domainmappings/www.barlaam.store' "$CURL_LOG"

: >"$GCLOUD_LOG"
PATH="$TEST_TMP:$PATH" bash "$ROOT_DIR/scripts/deploy-cloud-run.sh" api >/dev/null
grep -Fq 'run deploy laam-api' "$GCLOUD_LOG"
grep -Fq -- '--region=asia-northeast3' "$GCLOUD_LOG"
grep -Fq -- '--service-account=lam-cloud-run@lam-production.iam.gserviceaccount.com' "$GCLOUD_LOG"
grep -Fq 'PAYMENT_API_TOKEN=laam-payment-api-token:latest' "$GCLOUD_LOG"
grep -Fq 'QR_SIGNING_SECRET=laam-qr-signing-secret:latest' "$GCLOUD_LOG"
grep -Fq 'TOSS_PLACE_ACCESS_KEY=laam-toss-place-access-key:latest' "$GCLOUD_LOG"
grep -Fq 'TOSS_PLACE_SECRET_KEY=laam-toss-place-secret-key:latest' "$GCLOUD_LOG"
grep -Fq 'TOSS_PLACE_MERCHANT_ID=laam-toss-place-merchant-id:latest' "$GCLOUD_LOG"
grep -Fq 'TOSS_PLACE_WEBHOOK_SECRET=laam-toss-place-webhook-secret:latest' "$GCLOUD_LOG"
grep -Fq 'YOUTUBE_API_KEY=laam-youtube-api-key:latest' "$GCLOUD_LOG"
grep -Fq 'CUSTOMER_WEB_BASE_URL=https://www.barlaam.store' "$GCLOUD_LOG"
grep -Fq 'POS_ORDER_PROVIDER=open-api' "$GCLOUD_LOG"

: >"$GCLOUD_LOG"
CLOUD_RUN_POS_ORDER_PROVIDER=plugin PATH="$TEST_TMP:$PATH" bash "$ROOT_DIR/scripts/deploy-cloud-run.sh" api >/dev/null
grep -Fq 'POS_ORDER_PROVIDER=plugin' "$GCLOUD_LOG"
grep -Fq 'POS_PLUGIN_API_TOKEN=laam-pos-plugin-api-token:latest' "$GCLOUD_LOG"

: >"$GCLOUD_LOG"
if MOCK_MISSING_POS_PLUGIN_SECRET=1 CLOUD_RUN_POS_ORDER_PROVIDER=plugin PATH="$TEST_TMP:$PATH" bash "$ROOT_DIR/scripts/deploy-cloud-run.sh" api >/dev/null 2>&1; then
  printf '%s\n' 'plugin mode must fail when laam-pos-plugin-api-token is missing' >&2
  exit 1
fi

: >"$GCLOUD_LOG"
PATH="$TEST_TMP:$PATH" bash "$ROOT_DIR/scripts/deploy-cloud-run.sh" admin >/dev/null
grep -Fq 'run deploy laam-admin-web' "$GCLOUD_LOG"
grep -Fq -- '--region=asia-northeast3' "$GCLOUD_LOG"
grep -Fq -- '--service-account=lam-cloud-run@lam-production.iam.gserviceaccount.com' "$GCLOUD_LOG"

: >"$GCLOUD_LOG"
MOCK_MISSING_YOUTUBE_SECRET=1 PATH="$TEST_TMP:$PATH" bash "$ROOT_DIR/scripts/deploy-cloud-run.sh" api >/dev/null 2>&1
if grep -Fq 'YOUTUBE_API_KEY=laam-youtube-api-key:latest' "$GCLOUD_LOG"; then
  printf '%s\n' 'missing YouTube secret must not block or configure an API deployment' >&2
  exit 1
fi

: >"$CURL_LOG"
CLOUD_RUN_WEB_DOMAIN='' PATH="$TEST_TMP:$PATH" bash "$ROOT_DIR/scripts/deploy-cloud-run.sh" web >/dev/null
if [[ -s "$CURL_LOG" ]]; then
  printf '%s\n' 'empty CLOUD_RUN_WEB_DOMAIN must skip domain mapping' >&2
  exit 1
fi

printf '%s\n' 'deploy-cloud-run test passed'
