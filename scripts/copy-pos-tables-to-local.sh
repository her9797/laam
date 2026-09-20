#!/usr/bin/env bash
# 운영 DB의 POS 테이블 스냅샷과 QR 테이블 연결을 로컬 DB로 복사한다.
#
# 토스 POS의 테이블 목록은 매장 기기에 설치된 플러그인만 읽을 수 있어서
# 로컬에서는 직접 동기화할 수 없다. 그래서 이미 동기화된 운영 데이터를
# 그대로 가져와 같은 상태를 재현한다.
#
# 운영 DB는 읽기만 한다. 로컬 DB의 pos_tables, qr_tables만 비우고 다시
# 채우며, 주문·재고·지출 같은 다른 로컬 데이터는 건드리지 않는다.
#
#   bash scripts/copy-pos-tables-to-local.sh
#
# 환경변수
#   SOURCE_DATABASE_URL  운영 DB 주소. 없으면 laam-api/.env.local에서 주석 처리된
#                        DATABASE_URL 줄을 쓴다.
#   TARGET_DATABASE_URL  로컬 DB 주소. 없으면 laam-api/.env.local의 활성
#                        DATABASE_URL을 쓴다.
#   PSQL_CONTAINER       psql/pg_dump를 실행할 도커 컨테이너. 기본 laam-postgres-local.
#                        로컬에 psql이 설치돼 있으면 PSQL_CONTAINER= 로 비워서 직접 쓴다.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/laam-api/.env.local"
PSQL_CONTAINER="${PSQL_CONTAINER-laam-postgres-local}"

read_env_url() {
  # $1: 정규식. 값의 따옴표를 벗겨서 돌려준다.
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1//p" "$ENV_FILE" | head -1 | sed "s/^['\"]//; s/['\"]$//"
}

SOURCE_URL="${SOURCE_DATABASE_URL:-$(read_env_url '#[[:space:]]*DATABASE_URL=')}"
TARGET_URL="${TARGET_DATABASE_URL:-$(read_env_url 'DATABASE_URL=')}"

if [ -z "$SOURCE_URL" ]; then
  echo "운영 DB 주소를 찾지 못했다. SOURCE_DATABASE_URL을 넣어 실행한다." >&2
  exit 1
fi
if [ -z "$TARGET_URL" ]; then
  echo "로컬 DB 주소를 찾지 못했다. TARGET_DATABASE_URL을 넣어 실행한다." >&2
  exit 1
fi
if [ "$SOURCE_URL" = "$TARGET_URL" ]; then
  echo "원본과 대상이 같다. 운영 DB에 덮어쓰지 않도록 중단한다." >&2
  exit 1
fi

# 도커 컨테이너 안에서는 localhost가 컨테이너 자신을 가리킨다.
TARGET_URL_IN_CONTAINER="$TARGET_URL"
if [ -n "$PSQL_CONTAINER" ]; then
  TARGET_URL_IN_CONTAINER="${TARGET_URL//localhost/127.0.0.1}"
  TARGET_URL_IN_CONTAINER="${TARGET_URL_IN_CONTAINER//127.0.0.1:5433/127.0.0.1:5432}"
fi

run_psql() {
  # $1: 접속 문자열, 나머지: psql 인자
  local url="$1"; shift
  if [ -n "$PSQL_CONTAINER" ]; then
    docker exec -i "$PSQL_CONTAINER" psql "$url" "$@"
  else
    psql "$url" "$@"
  fi
}

describe() {
  # 로그에 접속 정보를 남기지 않도록 계정·비밀번호와 쿼리스트링을 지운다.
  printf '%s' "$1" | sed -E 's#^([a-z]+)://[^@]*@#\1://#; s#\?.*##'
}

echo "원본 $(describe "$SOURCE_URL") -> 대상 $(describe "$TARGET_URL")"

# 1) 운영에서 읽기(SELECT만). COPY ... TO STDOUT은 읽기 권한만 쓴다.
POS_DATA="$(run_psql "$SOURCE_URL" -At -c "COPY (SELECT pos_table_id, title, hall_id, hall_name, capacity, synced_at FROM pos_tables ORDER BY pos_table_id) TO STDOUT")"
QR_DATA="$(run_psql "$SOURCE_URL" -At -c "COPY (SELECT id, area, number, sort_order, pos_table_id, linked_at FROM qr_tables ORDER BY area, number, id) TO STDOUT")"

POS_COUNT="$(printf '%s' "$POS_DATA" | grep -c . || true)"
QR_COUNT="$(printf '%s' "$QR_DATA" | grep -c . || true)"
echo "읽음: POS 테이블 ${POS_COUNT}개, QR 테이블 ${QR_COUNT}개"
if [ "$POS_COUNT" = "0" ]; then
  echo "운영 DB에 POS 테이블이 없다. 매장에서 아직 동기화하지 않았을 수 있다." >&2
fi

# 2) 로컬에 쓰기. 한 트랜잭션으로 비우고 채운다.
{
  echo "BEGIN;"
  echo "DELETE FROM qr_tables;"
  echo "DELETE FROM pos_tables;"
  echo "COPY pos_tables (pos_table_id, title, hall_id, hall_name, capacity, synced_at) FROM STDIN;"
  printf '%s\n' "$POS_DATA"
  echo "\."
  echo "COPY qr_tables (id, area, number, sort_order, pos_table_id, linked_at) FROM STDIN;"
  printf '%s\n' "$QR_DATA"
  echo "\."
  echo "COMMIT;"
} | run_psql "$TARGET_URL_IN_CONTAINER" -v ON_ERROR_STOP=1 -q

# 3) 결과 확인
run_psql "$TARGET_URL_IN_CONTAINER" -c "
  SELECT q.id AS qr_code, COALESCE(p.title, '(연결 없음)') AS pos_table, COALESCE(p.hall_name, '-') AS hall
  FROM qr_tables q LEFT JOIN pos_tables p ON p.pos_table_id = q.pos_table_id
  ORDER BY q.area, q.number, q.id"
