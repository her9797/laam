#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: seed.sh [seed|reset]

관리자 웹의 계산서 기능(주문내역 메뉴별/계산서별 보기, 계산서 상세, 결제수단
라벨, 매출 통계)을 확인하기 위한 테스트 데이터를 로컬 Postgres에 넣거나 지운다.
id가 'seed-'로 시작하는 행만 다룬다.

명령:
  seed    (기본값) 기존 시드를 지우고 다시 넣는다. 여러 번 실행해도 결과가 같다.
  reset   시드 데이터만 지운다.

DB 연결:
  DATABASE_URL 환경변수 → laam-api/.env.local → laam-api/.env → .env.local → .env
  (laam-api가 읽는 순서와 같다) → postgres://laam:laam@localhost:5432/laam
  호스트가 localhost/127.0.0.1/::1이 아니면 실행을 거부한다.

  psql이 PATH에 있으면 그대로 쓰고, 없으면 해당 포트를 게시한 로컬 Postgres
  컨테이너를 찾아 docker exec로 실행한다. 컨테이너를 직접 지정하려면
  SEED_PG_CONTAINER=<이름>을 넘긴다.

사전 조건:
  laam-api를 이 DB로 한 번 이상 실행해서 스키마(pos_bills 등)가 만들어져 있어야 한다.
EOF
}

command="${1:-seed}"
case "$command" in
  seed | reset) ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"

# KEY=value 한 줄에서 값만 꺼낸다(laam-api config.loadEnvFile과 같은 규칙:
# export 접두어, 양끝 따옴표 허용). 값은 출력하지 않는다.
read_env_value() {
  local file="$1" key="$2" line value
  [ -f "$file" ] || return 1
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" | head -1 || true)"
  [ -n "$line" ] || return 1
  value="${line#*=}"
  value="$(printf '%s' "$value" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [ "${#value}" -ge 2 ]; then
    case "$value" in
      \'*\' | \"*\") value="${value:1:${#value}-2}" ;;
    esac
  fi
  [ -n "$value" ] || return 1
  printf '%s' "$value"
}

database_url="${DATABASE_URL:-}"
url_source="DATABASE_URL 환경변수"
if [ -z "$database_url" ]; then
  url_source=""
  for candidate in laam-api/.env.local laam-api/.env .env.local .env; do
    if value="$(read_env_value "$repo_root/$candidate" DATABASE_URL)"; then
      database_url="$value"
      url_source="$candidate"
      break
    fi
  done
fi
if [ -z "$database_url" ]; then
  database_url="postgres://laam:laam@localhost:5432/laam"
  url_source="기본값(docker compose)"
fi

# postgres[ql]://user[:password]@host[:port]/dbname[?params]
url_pattern='^postgres(ql)?://([^:@/]*)(:([^@]*))?@(\[[^]]*\]|[^:/?]*)(:([0-9]+))?/([^?]*)'
if [[ ! "$database_url" =~ $url_pattern ]]; then
  echo "DATABASE_URL(${url_source})을 postgres://user:password@host:port/db 형식으로 해석할 수 없습니다. 로컬 DB URL을 DATABASE_URL로 넘기세요." >&2
  exit 1
fi
db_user="${BASH_REMATCH[2]}"
db_password="${BASH_REMATCH[4]}"
db_host="${BASH_REMATCH[5]}"
db_port="${BASH_REMATCH[7]:-5432}"
db_name="${BASH_REMATCH[8]}"
db_host="${db_host#[}"
db_host="${db_host%]}"

# 안전장치: 로컬 DB만 허용한다. URL 전체(비밀번호 포함)는 출력하지 않는다.
case "$db_host" in
  localhost | 127.0.0.1 | ::1) ;;
  *)
    echo "로컬 DB가 아닙니다(host: ${db_host:-<없음>}, 출처: ${url_source}). 이 스크립트는 localhost/127.0.0.1/::1에만 실행합니다." >&2
    exit 1
    ;;
esac

echo "DB: ${db_host}:${db_port}/${db_name} (출처: ${url_source})" >&2

percent_decode() {
  local encoded="${1//+/%2B}"
  printf '%b' "${encoded//%/\\x}"
}

# psql이 PATH에 없으면 docker exec로 실행할 컨테이너와 컨테이너 내부 포트를 정한다.
container=""
container_port="5432"
if ! command -v psql >/dev/null 2>&1; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "psql도 docker도 찾을 수 없습니다. 둘 중 하나를 설치하세요." >&2
    exit 1
  fi
  container="${SEED_PG_CONTAINER:-}"
  if [ -z "$container" ]; then
    # 호스트 포트 db_port를 게시한 실행 중인 컨테이너를 찾는다.
    port_pattern=":${db_port}->([0-9]+)/tcp"
    while IFS=$'\t' read -r name ports; do
      if [[ "$ports" =~ $port_pattern ]]; then
        container="$name"
        container_port="${BASH_REMATCH[1]}"
        break
      fi
    done < <(docker ps --format '{{.Names}}\t{{.Ports}}')
  fi
  if [ -z "$container" ]; then
    echo "psql이 없고, 호스트 포트 ${db_port}를 게시한 Postgres 컨테이너도 찾지 못했습니다. SEED_PG_CONTAINER=<이름>으로 지정하세요." >&2
    exit 1
  fi
  echo "psql: docker exec ${container}" >&2
fi

run_psql() {
  if [ -z "$container" ]; then
    psql "$database_url" -X -q -v ON_ERROR_STOP=1 "$@"
    return
  fi
  docker exec -i \
    -e PGPASSWORD="$(percent_decode "$db_password")" \
    "$container" \
    psql -h 127.0.0.1 -p "$container_port" -U "$(percent_decode "$db_user")" -d "$(percent_decode "$db_name")" \
    -X -q -v ON_ERROR_STOP=1 "$@"
}

schema_ready="$(run_psql -tA -c "SELECT to_regclass('public.pos_bills') IS NOT NULL AND to_regclass('public.pos_payments') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment_orders' AND column_name = 'bill_id')" | tr -d '[:space:]')"
if [ "$schema_ready" != "t" ]; then
  echo "계산서 스키마(pos_bills, pos_payments, payment_orders.bill_id)가 없습니다. 이 DB로 laam-api를 한 번 실행해서 스키마를 만든 뒤 다시 실행하세요." >&2
  exit 1
fi

{
  echo 'BEGIN;'
  cat "$script_dir/reset.sql"
  if [ "$command" = "seed" ]; then
    cat "$script_dir/seed.sql"
  fi
  echo 'COMMIT;'
} | run_psql

counts="$(run_psql -tA -F ' / ' -c "SELECT
  (SELECT COUNT(*) FROM pos_bills WHERE id LIKE 'seed-%'),
  (SELECT COUNT(*) FROM pos_payments WHERE id LIKE 'seed-%'),
  (SELECT COUNT(*) FROM payment_orders WHERE id LIKE 'seed-%')" | tr -d '\r')"
echo "${command} 완료. 시드 계산서 / 결제 / 메뉴 행: ${counts}"
