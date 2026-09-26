# scripts

## send-test-tossplace-webhook.sh

실제 토스플레이스 결제 없이, 서명된 주문 웹훅(`POST /api/v1/webhooks/tossplace/orders`)을 로컬(또는 임의 URL)의 `laam-api`로 보내서 결제완료·취소 동기화 경로를 재현하는 스크립트. `./scripts/send-test-tossplace-webhook.sh --help` 참고.

로컬에서 쓰려면:

1. 테스트할 `payment_orders` 행을 하나 준비한다(실제 손님 주문 생성 플로우를 타거나, 로컬 Postgres에 직접 INSERT).
2. 그 주문에 쓰인 `laam-api` 인스턴스와 **같은** `TOSS_PLACE_WEBHOOK_SECRET` 값을 환경변수로 넘겨 스크립트를 실행한다. Docker Compose로 띄웠다면 저장소 루트 `.env`의 값, `go run`으로 직접 띄웠다면 `laam-api/.env`(또는 `.env.local`)의 값이다(`laam-api`가 시작 시 자동으로 읽는다). 둘은 서로 다른 값일 수 있다.
3. 응답이 `200`이고 주문의 `status`가 바뀌었는지 확인한다(REST로는 관리자 주문 조회, 직접 확인하려면 `payment_orders` 테이블 조회).

## local-payment-bills/seed.sh

실제 결제 없이 관리자 웹의 계산서 기능(주문내역 메뉴별/계산서별 보기, 계산서 상세 `/orders/bills/{id}`, 결제수단 라벨, 매출 통계)을 확인하도록 **로컬 DB에만** 테스트 계산서를 넣는다.

```bash
./scripts/local-payment-bills/seed.sh          # 시드 다시 넣기(기존 시드를 먼저 지운다)
./scripts/local-payment-bills/seed.sh reset    # 시드만 지우기
```

- DB는 `DATABASE_URL` 환경변수 → `laam-api/.env.local` → `laam-api/.env` → 루트 `.env.local` → 루트 `.env` → `postgres://laam:laam@localhost:5432/laam` 순으로 정한다. 호스트가 `localhost`/`127.0.0.1`/`::1`이 아니면 거부한다.
- `psql`이 없으면 그 포트를 게시한 Postgres 컨테이너를 찾아 `docker exec`로 실행한다(`SEED_PG_CONTAINER=<이름>`으로 지정 가능).
- 스키마는 laam-api가 시작할 때 만든다. `pos_bills`가 없다는 오류가 나면 그 DB로 laam-api를 한 번 띄운 뒤 다시 실행한다.
- id가 `seed-`로 시작하는 계산서·결제·메뉴 행만 넣고 지운다. 시각은 실행 시점 기준 1~4 영업일 전(16:00~06:00 KST)이라 기본 조회 범위(최근 7 영업일)에서 바로 보인다.

| 계산서 | 테이블 | 확인할 것 |
| --- | --- | --- |
| `seed-bill-01` | T-01 | 카드 단독 48,000원, 메뉴 3개(옵션·요청사항 포함) |
| `seed-bill-02` | T-03 | 카드 35,000 + 현금 20,000 분할 결제, 추가 주문 |
| `seed-bill-03` | B-03 | 계좌이체 32,000원 |
| `seed-bill-04` | T-05 | 메뉴 50,000 / 현금 결제 45,000, 할인 5,000 표시 |
| `seed-bill-05` | B-01 | 카드 42,000 취소 후 현금 42,000 재결제 |
| `seed-bill-06` | T-02 | 환불: 계산서·메뉴·결제 모두 취소, 매출 0 |
| `seed-bill-07` | T-07 | 결제 대기(OPEN), 메뉴 접수/대기 상태, 결제 없음(실행 40분 전) |
| `seed-bill-08` | T-04 | 결제 완료지만 결제 목록 미동기화: 상세에 "결제 내역을 아직 불러오는 중" 안내, 카드 20,000만 표시, 통계는 메뉴 금액 37,000을 `POS(미확인)`으로 집계 |
| `seed-bill-09` | B-02 | 간편결제 51,000, POS에서 직접 찍은 메뉴(카스 병맥주, 테이블 없음) 포함 |
| `seed-legacy-1~3` | T-06, T-08 | 계산서 없는 과거 행 32,000원, 결제수단 `POS(미확인)` |

시드만 놓고 보면 매출 통계(결제 기준)는 카드 83,000 / 현금 107,000 / 계좌이체 32,000 / 간편결제 51,000 / POS(미확인) 69,000, 합계 342,000원, 주문 23건이다. 카테고리·테이블·메뉴별 통계는 메뉴 금액 기준이라 합계가 347,000원(할인 5,000 차이)이다. laam-api가 처음 만드는 샘플 주문(`sample-order-*`)이나 직접 만든 주문이 같은 기간에 있으면 그만큼 더해진다.

`seed-bill-08`은 결제 목록 재동기화 대상이라, TossPlace 키가 설정된 laam-api에 웹훅이 들어오면 존재하지 않는 POS 주문(`seed-pos-08`)을 조회하려다 실패 로그를 남긴다. 확인이 끝나면 `reset`으로 지운다.

## deploy-cloud-run.sh

`laam-api`, `laam-web`, `laam-admin-web`를 Google Cloud Run에 배포하는 스크립트.

### 사용법

```bash
./scripts/deploy-cloud-run.sh            # 전체 배포 (laam-api, laam-web, laam-admin-web)
./scripts/deploy-cloud-run.sh admin      # laam-admin-web만 배포
./scripts/deploy-cloud-run.sh api        # laam-api만 배포
./scripts/deploy-cloud-run.sh web        # laam-web만 배포
./scripts/deploy-cloud-run.sh --help     # 사용법 출력
```

인자를 생략하면 `all`(전체 배포)로 동작한다. `web` 또는 `admin`만 배포해도 이미 배포되어 있는 `laam-api`의 URL을 조회해서 `API_BASE_URL`로 연결한다 — `laam-api`가 아직 한 번도 배포된 적이 없다면 먼저 `api`를 배포해야 한다.

실행 환경(Windows Git Bash/Cygwin vs Mac/Linux)에 따라 `gcloud` 실행 파일을 자동으로 선택하므로 파일 하나로 양쪽 OS에서 그대로 쓸 수 있다.

### 사전 준비

1. `gcloud` 설치 및 인증
   ```bash
   gcloud auth login
   gcloud config set project lam-production
   ```
2. 아래 Secret Manager 시크릿이 미리 생성되어 있어야 한다. `laam-youtube-api-key`는 선택 항목이며, 없으면 배포는 계속되지만 신청곡 승인은 비활성화된다. `laam-pos-plugin-api-token`은 POS 플러그인 모드를 사용할 때만 필요하다.

   | 시크릿 | 사용하는 서비스 |
   | --- | --- |
   | `laam-database-url` | laam-api |
   | `laam-admin-api-token` | laam-api, laam-admin-web (두 곳 값이 동일해야 함) |
   | `laam-payment-api-token` | laam-api, laam-web (두 곳 값이 동일해야 함) |
   | `laam-supabase-secret-key` | laam-api (`SUPABASE_BROADCAST_KEY`와 영수증 사진 저장용 `SUPABASE_STORAGE_KEY`에 같은 값을 주입. Storage 비공개 버킷 `expense-receipts` 필요) |
   | `laam-supabase-url` | laam-api |
   | `laam-toss-place-access-key` | laam-api |
   | `laam-toss-place-secret-key` | laam-api |
   | `laam-toss-place-merchant-id` | laam-api |
   | `laam-toss-place-webhook-secret` | laam-api (TossPlace 개발자센터에서 주문 웹훅 등록 시 발급되는 서명 키. 위 `laam-toss-place-secret-key`와 다른 값) |
   | `laam-youtube-api-key` | laam-api (YouTube Data API v3 서버 키) |
   | `laam-pos-plugin-api-token` | laam-api, 매장 POS 플러그인 설정 (플러그인 모드에서만 필요) |
   | `laam-web-session-secret` | laam-web |
   | `laam-staff-entry-token` | laam-web |
   | `laam-qr-signing-secret` | laam-web, laam-api (두 곳 값이 동일해야 함) |
   | `laam-qr-access-token` | laam-web |
   | `laam-customer-test-entry-token` | laam-web |
   | `laam-admin-web-admin-password` | laam-admin-web |
   | `laam-admin-web-session-secret` | laam-admin-web |

   없는 시크릿은 **생성과 권한 부여를 한 쌍으로** 수행한다. 이 프로젝트는 시크릿 단위로 접근 권한을 주므로, 생성만 하고 권한을 빼먹으면 배포가 `Permission denied on secret ... The service account used must be granted the 'Secret Manager Secret Accessor' role`로 실패한다.
   ```bash
   printf '%s' '<값>' | gcloud secrets create <시크릿 이름> --data-file=- --project=lam-production
   gcloud secrets add-iam-policy-binding <시크릿 이름> \
     --member="serviceAccount:lam-cloud-run@lam-production.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor" --project=lam-production
   ```
   이미 있는 시크릿의 값을 바꿀 때는 `create` 대신 `versions add`를 쓴다. 권한은 시크릿에 붙어 있으므로 다시 부여하지 않아도 된다.
   ```bash
   printf '%s' '<새 값>' | gcloud secrets versions add <시크릿 이름> --data-file=- --project=lam-production
   ```

   `printf '%s'`를 쓰는 이유는 값 끝에 개행을 넣지 않기 위해서다. `echo`를 쓰거나 Windows에서 CRLF `.env`를 그대로 파이프하면 값 끝에 `\n`이나 `\r`이 섞여 들어가고, 서명 키의 경우 프로덕션 HMAC 검증이 전부 실패한다. 겉으로는 값이 맞아 보여 원인을 찾기 어려우므로, 생성 후 저장된 값이 의도한 값과 같은지 확인한다.
   ```bash
   # 길이와 해시만 비교한다. 값 자체를 출력하지 않는다.
   gcloud secrets versions access latest --secret=<시크릿 이름> --project=lam-production | wc -c
   gcloud secrets versions access latest --secret=<시크릿 이름> --project=lam-production | sha256sum
   ```

3. 모든 서비스는 기본적으로 `lam-cloud-run@lam-production.iam.gserviceaccount.com` 서비스 계정을 사용한다. 이 계정에 필요한 시크릿 접근 권한(`roles/secretmanager.secretAccessor`)이 있어야 한다. 위 2번처럼 시크릿마다 개별 부여하는 방식이며 프로젝트 레벨 상속에 의존하지 않는다.

4. 기본 커스텀 도메인 `www.barlaam.store`의 소유권과 DNS가 확인되어 있어야 한다. 스크립트는 `laam-web` 배포 후 기존 매핑 대상을 확인하고, 매핑이 없으면 생성한다.

### 환경변수로 덮어쓸 수 있는 값

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | `lam-production` | GCP 프로젝트 ID |
| `CLOUD_RUN_API_REGION` | `asia-northeast3` | laam-api 리전 |
| `CLOUD_RUN_WEB_REGION` | `asia-northeast1` | laam-web 리전 |
| `CLOUD_RUN_ADMIN_WEB_REGION` | `asia-northeast3` | laam-admin-web 리전 |
| `CLOUD_RUN_POS_ORDER_PROVIDER` | `open-api` | `plugin`으로 지정하면 API의 Open API 주문 생성을 끄고 POS Worker 플러그인 전달 모드를 활성화한다. 이때 `laam-pos-plugin-api-token` 시크릿이 반드시 있어야 한다 |
| `CLOUD_RUN_WEB_DOMAIN` | `www.barlaam.store` | laam-web 커스텀 도메인. 빈 문자열이면 매핑 확인·생성을 생략하고, laam-api에 넘기는 `CUSTOMER_WEB_BASE_URL`(관리자 테이블 QR이 여는 주소)도 이미 배포된 laam-web의 Cloud Run URL로 대체된다 |
| `CLOUD_RUN_SERVICE_ACCOUNT` | `lam-cloud-run@<project>.iam.gserviceaccount.com` | 모든 Cloud Run 서비스의 실행 서비스 계정 |
| `CLOUD_RUN_NEXT_PUBLIC_SUPABASE_URL` | 현재 운영 Supabase 프로젝트 URL | laam-admin-web 빌드 시점에 번들에 박히는 값 |
| `CLOUD_RUN_NEXT_PUBLIC_SUPABASE_ANON_KEY` | 현재 운영 Supabase anon key | 위와 동일. anon/publishable key는 브라우저에 공개되도록 설계된 값이라 스크립트에 기본값으로 두어도 안전하다(RLS로 보호됨) |

### 배포 후 확인

```bash
gcloud run services describe laam-admin-web --project=lam-production --region=asia-northeast3 --format='value(status.url)'
```

나온 URL 접속 후 `/login` 화면이 뜨는지 확인한다. `web`을 배포한 경우에는 출력된 커스텀 도메인의 `/access-required`에서 고객 테스트 입장 폼도 확인한다.

`api`를 배포했다면 아래까지 확인한다. "배포 성공"은 컨테이너가 떴다는 뜻일 뿐, 시크릿이 의도한 값으로 주입됐는지는 증명하지 않는다.

```bash
API=https://<laam-api 배포 후 실제로 나온 Cloud Run URL>

curl -s -o /dev/null -w '%{http_code}\n' "$API/health"                      # 200

# TossPlace 주문 웹훅: 서명이 없으면 401이어야 한다.
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/v1/webhooks/tossplace/orders" \
  -H 'Content-Type: application/json' -d '{"type":"order.order.completed.v1"}'   # 401

# 올바른 서명이면 200이어야 한다. 200이 나오면 Secret Manager의
# laam-toss-place-webhook-secret이 실제로 주입됐고 HMAC 검증이 통과한다는 뜻이다.
# 존재하지 않는 orderKey를 쓰므로 실제 주문 데이터는 건드리지 않는다.
SECRET=$(grep '^TOSS_PLACE_WEBHOOK_SECRET=' ../laam-api/.env | cut -d= -f2- | tr -d '\r\n')
TS=$(date +%s)000
BODY='{"id":"deploy-check","type":"order.order.completed.v1","data":{"orderKey":"nonexistent-deploy-check"}}'
SIG="v1=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/.*= //')"
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/v1/webhooks/tossplace/orders" \
  -H 'Content-Type: application/json' -H "x-toss-timestamp: $TS" -H "x-toss-signature: $SIG" -d "$BODY"   # 200
```

여기까지 통과해도 종단 간 검증은 아니다. 실제 매장에서 POS 결제와 취소를 한 번씩 해보고 관리자 주문 목록의 상태가 결제완료·취소로 바뀌는지 확인해야 완결된다.

### 알려진 문제

- **`laam-api` 배포는 됐는데 헬스체크 타임아웃으로 실패하는 경우**: `laam-api`는 HTTP 서버를 띄우기 전에 DB 커넥션과 스키마 마이그레이션을 먼저 수행한다([laam-api/cmd/server/main.go](../laam-api/cmd/server/main.go)). 이 단계가 실패하면 포트 리슨 전에 프로세스가 죽어서 Cloud Run이 "포트 리슨 실패"로 보고한다. 아래로 실제 원인(대부분 `laam-database-url` 시크릿의 DB 비밀번호 불일치)을 확인한다.
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="laam-api"' --project=lam-production --limit=50 --format='value(timestamp,severity,textPayload)' --order=asc
  ```

- **`Permission denied on secret ... /versions/latest`로 revision 생성이 실패하는 경우**: 시크릿은 있지만 `lam-cloud-run` 서비스 계정에 `secretAccessor`가 부여되지 않은 것이다. 새로 만든 시크릿에서 주로 발생한다. 위 "사전 준비" 2번의 `add-iam-policy-binding`을 실행한 뒤 다시 배포한다. 현재 부여 상태는 아래로 확인한다.
  ```bash
  gcloud secrets get-iam-policy <시크릿 이름> --project=lam-production
  ```

- **`gcloud crashed (PermissionError): '.next\dev\lock'`로 소스 업로드가 실패하는 경우**: `gcloud run deploy --source`는 `.dockerignore`가 아니라 `.gcloudignore`를 본다. `laam-admin-web/.gcloudignore`가 빠지거나 잘못되면 로컬 `.next`(1GB 이상)와 `node_modules`까지 업로드되고, 로컬 dev 서버가 떠 있으면 잠긴 파일에서 깨진다. `.gcloudignore`가 있는지 확인하고, 로컬에서 `next dev`나 `next start`를 띄워뒀다면 종료한 뒤 다시 배포한다. `.dockerignore`와 `.gcloudignore`는 같은 의도를 유지해야 하므로 한쪽만 고치지 않는다.

- **`Setting IAM policy failed ... --member=allUsers --role=roles/run.invoker` 경고**: 조직 정책이 `allUsers` 부여를 막을 때 나온다. 이미 공개로 배포된 기존 서비스는 권한이 유지되므로 이 경고만으로는 장애가 아니며, 배포 후 확인 절차에서 외부 요청이 200으로 응답하면 정상이다. 다만 **새 서비스를 처음 배포할 때는 실제로 공개되지 않으므로** 별도로 권한을 부여해야 한다.

- **`deploy-cloud-run.test.sh`를 검증용으로 실행하지 않는다**: 이름과 달리 Windows(Git Bash)에서 실행하면 실제 배포가 수행된다. 이 테스트는 `PATH` 앞에 `gcloud` mock을 놓는데, `deploy-cloud-run.sh`는 `OSTYPE`이 `msys`/`cygwin`이면 `gcloud.cmd`로 분기하므로 mock이 우회된다. 배포 스크립트 변경은 `bash -n`과 diff 확인 같은 정적 검증으로 대신한다.
