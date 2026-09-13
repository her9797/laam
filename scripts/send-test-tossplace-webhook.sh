#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: send-test-tossplace-webhook.sh <orderKey> [completed|cancelled] [URL]

실제 토스플레이스 결제 없이, 로컬(또는 임의 URL)의 lam-api로 서명된 주문
웹훅(POST /api/v1/webhooks/tossplace/orders)을 보내서 결제완료·취소 동기화
경로를 재현한다.

인자:
  orderKey   동기화할 lam-api 내부 주문 id(payment_orders.id). 실제로 존재하는
             주문이어야 상태가 바뀐다 — 존재하지 않으면 핸들러가 로그만 남기고
             200을 반환한다(무효과).
  event      completed(기본값) 또는 cancelled.
  URL        웹훅 엔드포인트. 기본값은 docker-compose로 띄운 로컬 lam-api
             (http://localhost:9090/api/v1/webhooks/tossplace/orders).

환경변수:
  TOSS_PLACE_WEBHOOK_SECRET   서명에 쓸 시크릿. 대상 lam-api 인스턴스에 설정된
                              값과 정확히 같아야 한다. 비워두면 lam-api/.env의
                              TOSS_PLACE_WEBHOOK_SECRET 값을 자동으로 읽는다
                              (로컬 lam-api를 대상으로 할 때만 의미가 있다 —
                              배포된 환경을 대상으로 하려면 그 환경의 실제
                              값을 직접 넘겨야 한다).

예시:
  # 1) 테스트용 주문을 하나 만든다 (손님 웹 주문 생성 API, 또는 직접 INSERT).
  # 2) 그 주문의 id로 완료 웹훅을 보낸다. 로컬 lam-api가 대상이면 시크릿은
  #    생략해도 lam-api/.env에서 자동으로 읽는다.
  ./scripts/send-test-tossplace-webhook.sh <orderId> completed

  # 취소 테스트, 배포된 환경을 대상으로.
  TOSS_PLACE_WEBHOOK_SECRET=<실제 시크릿> \
    ./scripts/send-test-tossplace-webhook.sh <orderId> cancelled \
    https://lam-api-yterzctnuq-du.a.run.app/api/v1/webhooks/tossplace/orders
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ $# -lt 1 ]; then
  usage
  exit "$([ $# -lt 1 ] && echo 1 || echo 0)"
fi

order_key="$1"
event="${2:-completed}"
url="${3:-http://localhost:9090/api/v1/webhooks/tossplace/orders}"
secret="${TOSS_PLACE_WEBHOOK_SECRET:-}"

# 환경변수로 안 넘겼으면 이 스크립트 옆 lam-api/.env에서 자동으로 읽는다.
# 로컬 lam-api를 대상으로 할 때 매번 값을 직접 넘기지 않아도 되게 하는
# 용도라, 배포 환경을 대상으로 할 때는 여전히 TOSS_PLACE_WEBHOOK_SECRET을
# 직접 넘겨야 한다(로컬 .env 값과 다르다).
if [ -z "$secret" ]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local_env_file="$script_dir/../lam-api/.env"
  if [ -f "$local_env_file" ]; then
    secret="$(grep '^TOSS_PLACE_WEBHOOK_SECRET=' "$local_env_file" | tail -1 | cut -d= -f2- | tr -d '\r\n')"
    if [ -n "$secret" ]; then
      echo "TOSS_PLACE_WEBHOOK_SECRET: lam-api/.env에서 읽음" >&2
    fi
  fi
fi

if [ -z "$secret" ]; then
  echo "TOSS_PLACE_WEBHOOK_SECRET이 비어 있습니다. lam-api/.env에도 값이 없습니다. 대상 lam-api에 설정된 값과 같은 값을 환경변수로 넘기세요." >&2
  exit 1
fi

case "$event" in
  completed)
    event_type="order.order.completed.v1"
    timestamp_field="completedAt"
    ;;
  cancelled)
    event_type="order.order.cancelled.v1"
    timestamp_field="cancelledAt"
    ;;
  *)
    echo "event는 completed 또는 cancelled만 가능합니다: $event" >&2
    exit 1
    ;;
esac

event_id="test-$(date +%s)"
event_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# lam-api가 내부 주문을 찾는 키는 orderKey다 (CreateOrder 호출 시 우리
# 내부 주문 id를 toss의 orderKey로 보내기 때문). orderId는 POS 쪽 주문
# id라 동기화 로직이 쓰지 않으므로 아무 값이나 넣는다.
body=$(printf '{"id":"%s","type":"%s","createdAt":"%s","data":{"orderId":"test-pos-order","orderKey":"%s","orderNumber":"TEST-0001","source":"local-test","%s":"%s"}}' \
  "$event_id" "$event_type" "$event_time" "$order_key" "$timestamp_field" "$event_time")

timestamp_ms="$(date +%s)000"
signature="v1=$(printf '%s.%s' "$timestamp_ms" "$body" | openssl dgst -sha256 -hmac "$secret" -hex | sed 's/^.* //')"

echo "POST $url"
echo "body: $body"
echo

http_code=$(curl -s -o /tmp/send-test-tossplace-webhook.response -w '%{http_code}' -X POST "$url" \
  -H 'Content-Type: application/json' \
  -H "x-toss-timestamp: $timestamp_ms" \
  -H "x-toss-signature: $signature" \
  -d "$body")

echo "status: $http_code"
cat /tmp/send-test-tossplace-webhook.response
echo
rm -f /tmp/send-test-tossplace-webhook.response
