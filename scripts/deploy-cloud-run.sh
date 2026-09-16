#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: deploy-cloud-run.sh [SERVICE...]

SERVICE는 api, web, admin, all 중 하나 이상. 생략하면 all(전체 배포)로 동작한다.

예시:
  ./scripts/deploy-cloud-run.sh            # laam-api, laam-web, laam-admin-web 전체 배포
  ./scripts/deploy-cloud-run.sh admin      # laam-admin-web만 배포
  ./scripts/deploy-cloud-run.sh api        # laam-api만 배포
  ./scripts/deploy-cloud-run.sh web        # laam-web만 배포

자세한 사전 준비(시크릿, 권한)와 환경변수 목록은 scripts/README.md 참고.
EOF
}

contains() {
  local needle="$1"
  shift
  local x
  for x in "$@"; do
    [ "$x" = "$needle" ] && return 0
  done
  return 1
}

SERVICES=()
if [ "$#" -eq 0 ]; then
  SERVICES=(api web admin)
else
  for arg in "$@"; do
    case "$arg" in
      all) SERVICES+=(api web admin) ;;
      api|web|admin) SERVICES+=("$arg") ;;
      -h|--help) usage; exit 0 ;;
      *)
        echo "알 수 없는 SERVICE: $arg" >&2
        usage >&2
        exit 1
        ;;
    esac
  done
fi

# Windows(Git Bash/MSYS, Cygwin)에서는 PATH의 `gcloud`가 `gcloud.ps1`로 잘못
# 해석되거나 인터랙티브 처리가 깨지는 경우가 있어 `gcloud.cmd`를 직접 호출해야
# 한다. Mac/Linux 네이티브 셸에서는 `gcloud`가 정상 동작한다.
case "${OSTYPE:-}" in
  msys*|cygwin*|win32*)
    GCLOUD=gcloud.cmd
    ;;
  *)
    GCLOUD=gcloud
    ;;
esac

# GCP 프로젝트 ID와 서비스 계정 ID는 생성 후 변경할 수 없는 값이라 lam-* 그대로
# 남아있다 — 이름만 다른 laam-production 프로젝트를 새로 파거나
# laam-cloud-run 서비스 계정을 새로 만들어 모든 권한을 다시 부여하지 않는 한
# 못 바꾼다. Cloud Run 서비스명과 Secret Manager 시크릿명은 laam-*로 새로
# 만들었고, 이 스크립트도 그 새 이름을 쓴다(기존 lam-* 리소스는 확인 후 별도로
# 정리한다).
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-lam-production}"
API_REGION="${CLOUD_RUN_API_REGION:-asia-northeast3}"
WEB_REGION="${CLOUD_RUN_WEB_REGION:-asia-northeast1}"
ADMIN_WEB_REGION="${CLOUD_RUN_ADMIN_WEB_REGION:-asia-northeast3}"
POS_ORDER_PROVIDER="${CLOUD_RUN_POS_ORDER_PROVIDER:-open-api}"
WEB_DOMAIN="${CLOUD_RUN_WEB_DOMAIN-www.barlaam.store}"
CLOUD_RUN_SERVICE_ACCOUNT="${CLOUD_RUN_SERVICE_ACCOUNT:-${CLOUD_RUN_WEB_SERVICE_ACCOUNT:-lam-cloud-run@${PROJECT_ID}.iam.gserviceaccount.com}}"
NEXT_PUBLIC_SUPABASE_URL="${CLOUD_RUN_NEXT_PUBLIC_SUPABASE_URL:-https://escntlunkvcoiylczijh.supabase.co}"
NEXT_PUBLIC_SUPABASE_ANON_KEY="${CLOUD_RUN_NEXT_PUBLIC_SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzY250bHVua3Zjb2l5bGN6aWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODEyODUsImV4cCI6MjEwMzg1NzI4NX0.MSZoTACZWK_6wGEPFPbYe3Umz0ECnsG6ztoKM_bEZ0E}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

deploy_api() {
  local customer_web_base_url="$1"
  local api_secrets
  api_secrets="DATABASE_URL=laam-database-url:latest,ADMIN_API_TOKEN=laam-admin-api-token:latest,PAYMENT_API_TOKEN=laam-payment-api-token:latest,SUPABASE_BROADCAST_KEY=laam-supabase-secret-key:latest,SUPABASE_URL=laam-supabase-url:latest,QR_SIGNING_SECRET=laam-qr-signing-secret:latest,TOSS_PLACE_ACCESS_KEY=laam-toss-place-access-key:latest,TOSS_PLACE_SECRET_KEY=laam-toss-place-secret-key:latest,TOSS_PLACE_MERCHANT_ID=laam-toss-place-merchant-id:latest,TOSS_PLACE_WEBHOOK_SECRET=laam-toss-place-webhook-secret:latest"
  if "$GCLOUD" secrets describe laam-youtube-api-key --project="$PROJECT_ID" >/dev/null 2>&1; then
    api_secrets+=",YOUTUBE_API_KEY=laam-youtube-api-key:latest"
  else
    printf 'Warning: laam-youtube-api-key is missing; song approval will stay disabled.\n' >&2
  fi
  case "$POS_ORDER_PROVIDER" in
    open-api) ;;
    plugin)
      if ! "$GCLOUD" secrets describe laam-pos-plugin-api-token --project="$PROJECT_ID" >/dev/null 2>&1; then
        printf 'Error: plugin mode requires Secret Manager secret laam-pos-plugin-api-token.\n' >&2
        return 1
      fi
      api_secrets+=",POS_PLUGIN_API_TOKEN=laam-pos-plugin-api-token:latest"
      ;;
    *)
      printf 'Error: CLOUD_RUN_POS_ORDER_PROVIDER must be open-api or plugin.\n' >&2
      return 1
      ;;
  esac

  "$GCLOUD" run deploy laam-api \
    --project="$PROJECT_ID" \
    --source="$ROOT_DIR/laam-api" \
    --region="$API_REGION" \
    --service-account="$CLOUD_RUN_SERVICE_ACCOUNT" \
    --allow-unauthenticated \
    --min-instances=0 \
    --max-instances=1 \
    --set-secrets="$api_secrets" \
    --set-env-vars="ALLOWED_ORIGIN=*,CUSTOMER_WEB_BASE_URL=$customer_web_base_url,POS_ORDER_PROVIDER=$POS_ORDER_PROVIDER" \
    --quiet
}

get_api_base_url() {
  "$GCLOUD" run services describe laam-api \
    --project="$PROJECT_ID" \
    --region="$API_REGION" \
    --format='value(status.url)'
}

get_web_base_url() {
  "$GCLOUD" run services describe laam-web \
    --project="$PROJECT_ID" \
    --region="$WEB_REGION" \
    --format='value(status.url)' 2>/dev/null
}

deploy_web() {
  local api_base_url="$1"
  "$GCLOUD" run deploy laam-web \
    --project="$PROJECT_ID" \
    --source="$ROOT_DIR/laam-web" \
    --region="$WEB_REGION" \
    --service-account="$CLOUD_RUN_SERVICE_ACCOUNT" \
    --allow-unauthenticated \
    --min-instances=0 \
    --max-instances=1 \
    --set-env-vars="API_BASE_URL=$api_base_url" \
    --set-secrets=PAYMENT_API_TOKEN=laam-payment-api-token:latest,SESSION_SECRET=laam-web-session-secret:latest,QR_SIGNING_SECRET=laam-qr-signing-secret:latest,QR_ACCESS_TOKEN=laam-qr-access-token:latest,STAFF_ENTRY_TOKEN=laam-staff-entry-token:latest,CUSTOMER_TEST_ENTRY_TOKEN=laam-customer-test-entry-token:latest \
    --quiet
}

ensure_web_domain_mapping() {
  local domain_api="https://${WEB_REGION}-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/${PROJECT_ID}/domainmappings"
  local cloud_access_token
  local domain_response
  local domain_status
  local domain_body

  cloud_access_token="$("$GCLOUD" auth print-access-token)"
  domain_response="$(curl -sS \
    -H "Authorization: Bearer ${cloud_access_token}" \
    -w $'\n%{http_code}' \
    "${domain_api}/${WEB_DOMAIN}")"
  domain_status="${domain_response##*$'\n'}"
  domain_body="${domain_response%$'\n'*}"

  case "$domain_status" in
    200)
      if ! grep -Eq '"routeName"[[:space:]]*:[[:space:]]*"laam-web"' <<<"$domain_body"; then
        printf 'Domain mapping %s exists but does not target laam-web.\n' "$WEB_DOMAIN" >&2
        exit 1
      fi
      ;;
    404)
      curl -fsS \
        -X POST \
        -H "Authorization: Bearer ${cloud_access_token}" \
        -H 'Content-Type: application/json' \
        --data "{\"apiVersion\":\"domains.cloudrun.com/v1\",\"kind\":\"DomainMapping\",\"metadata\":{\"name\":\"${WEB_DOMAIN}\",\"namespace\":\"${PROJECT_ID}\"},\"spec\":{\"routeName\":\"laam-web\",\"certificateMode\":\"AUTOMATIC\"}}" \
        "$domain_api" >/dev/null
      ;;
    *)
      printf 'Could not inspect domain mapping %s (HTTP %s).\n' "$WEB_DOMAIN" "$domain_status" >&2
      exit 1
      ;;
  esac
}

# NEXT_PUBLIC_* 값은 laam-admin-web/Dockerfile의 ARG로 받아 `npm run build`
# 시점에 클라이언트 번들에 그대로 박힌다 — 컨테이너 실행 시점 환경변수가 아니므로
# --set-secrets로는 넣을 수 없고, --set-build-env-vars는 리터럴 값만 받는다.
# 값 자체는 비밀이 아니다 — anon/publishable key는 브라우저에 공개되도록
# 설계된 값이다(docs/plans/2026-09-04-admin-request-notifications.md 참고).
# 다른 Supabase 프로젝트로 배포하려면 CLOUD_RUN_NEXT_PUBLIC_SUPABASE_URL /
# CLOUD_RUN_NEXT_PUBLIC_SUPABASE_ANON_KEY 셸 환경변수로 덮어쓴다.
#
# --set-build-env-vars가 이 저장소의 Dockerfile 기반 소스 배포에서 정확히
# ARG로 전달되는지는 공식 문서로 확정하지 못했다 — 최초 배포 후 로그인해
# 브라우저 개발자도구 Network(WS) 탭에서 wss://<project-ref>.supabase.co/realtime/...
# 연결이 뜨는지로 직접 확인한다.
deploy_admin() {
  local api_base_url="$1"
  "$GCLOUD" run deploy laam-admin-web \
    --project="$PROJECT_ID" \
    --source="$ROOT_DIR/laam-admin-web" \
    --region="$ADMIN_WEB_REGION" \
    --service-account="$CLOUD_RUN_SERVICE_ACCOUNT" \
    --allow-unauthenticated \
    --min-instances=0 \
    --max-instances=1 \
    --set-env-vars="API_BASE_URL=$api_base_url" \
    --set-secrets=ADMIN_API_TOKEN=laam-admin-api-token:latest,ADMIN_PASSWORD=laam-admin-web-admin-password:latest,SESSION_SECRET=laam-admin-web-session-secret:latest \
    --set-build-env-vars="NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    --quiet
}

# laam-api가 발급하는 테이블 QR은 이 주소로 고객 폰 브라우저를 연다. 커스텀 도메인이
# 설정되어 있으면(기본값) 그 주소를 쓰고, 없으면 이미 존재하는(또는 방금 배포한)
# laam-web의 Cloud Run URL을 조회한다 — laam-web이 아직 한 번도 배포되지 않았다면
# 빈 값이 되어 /api/v1/admin/tables가 500을 내니, 이후 laam-web을 배포한 뒤 이
# 스크립트를 다시 실행해 laam-api를 갱신해야 한다.
if [[ -n "$WEB_DOMAIN" ]]; then
  CUSTOMER_WEB_BASE_URL="https://$WEB_DOMAIN"
else
  CUSTOMER_WEB_BASE_URL="$(get_web_base_url)"
  if [[ -z "$CUSTOMER_WEB_BASE_URL" ]]; then
    printf 'Warning: laam-web is not deployed yet and CLOUD_RUN_WEB_DOMAIN is unset; laam-api will start with an empty CUSTOMER_WEB_BASE_URL and its /api/v1/admin/tables endpoint will 500 until laam-web is deployed and this script is re-run.\n' >&2
  fi
fi

if contains api "${SERVICES[@]}"; then
  deploy_api "$CUSTOMER_WEB_BASE_URL"
fi

# web/admin 배포에는 laam-api URL이 필요하고, api만 배포한 경우도 결과 요약에
# 쓰이므로 이미 존재하는(또는 방금 배포한) laam-api를 기준으로 항상 조회한다.
API_BASE_URL="$(get_api_base_url)"

WEB_URL=""
if contains web "${SERVICES[@]}"; then
  deploy_web "$API_BASE_URL"
  if [[ -n "$WEB_DOMAIN" ]]; then
    ensure_web_domain_mapping
  fi
  WEB_URL="$("$GCLOUD" run services describe laam-web \
    --project="$PROJECT_ID" \
    --region="$WEB_REGION" \
    --format='value(status.url)')"
fi

ADMIN_WEB_URL=""
if contains admin "${SERVICES[@]}"; then
  deploy_admin "$API_BASE_URL"
  ADMIN_WEB_URL="$("$GCLOUD" run services describe laam-admin-web \
    --project="$PROJECT_ID" \
    --region="$ADMIN_WEB_REGION" \
    --format='value(status.url)')"
fi

printf 'Deployment complete.\n'
[ -n "$API_BASE_URL" ] && printf '  api:   %s\n' "$API_BASE_URL"
[ -n "$WEB_URL" ] && printf '  web:   %s\n' "$WEB_URL"
[ -n "$ADMIN_WEB_URL" ] && printf '  admin: %s\n' "$ADMIN_WEB_URL"
if [[ -n "$WEB_URL" && -n "$WEB_DOMAIN" ]]; then
  printf '  domain: https://%s\n' "$WEB_DOMAIN"
fi
