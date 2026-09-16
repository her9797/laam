# scripts

## send-test-tossplace-webhook.sh

실제 토스플레이스 결제 없이, 서명된 주문 웹훅(`POST /api/v1/webhooks/tossplace/orders`)을 로컬(또는 임의 URL)의 `lam-api`로 보내서 결제완료·취소 동기화 경로를 재현하는 스크립트. `./scripts/send-test-tossplace-webhook.sh --help` 참고.

로컬에서 쓰려면:

1. 테스트할 `payment_orders` 행을 하나 준비한다(실제 손님 주문 생성 플로우를 타거나, 로컬 Postgres에 직접 INSERT).
2. 그 주문에 쓰인 `lam-api` 인스턴스와 **같은** `TOSS_PLACE_WEBHOOK_SECRET` 값을 환경변수로 넘겨 스크립트를 실행한다. Docker Compose로 띄웠다면 저장소 루트 `.env`의 값, `go run`으로 직접 띄웠다면 `laam-api/.env`(또는 `.env.local`)의 값이다(`lam-api`가 시작 시 자동으로 읽는다). 둘은 서로 다른 값일 수 있다.
3. 응답이 `200`이고 주문의 `status`가 바뀌었는지 확인한다(REST로는 관리자 주문 조회, 직접 확인하려면 `payment_orders` 테이블 조회).

## deploy-cloud-run.sh

`lam-api`, `lam-web`, `lam-admin-web`를 Google Cloud Run에 배포하는 스크립트.

### 사용법

```bash
./scripts/deploy-cloud-run.sh            # 전체 배포 (lam-api, lam-web, lam-admin-web)
./scripts/deploy-cloud-run.sh admin      # lam-admin-web만 배포
./scripts/deploy-cloud-run.sh api        # lam-api만 배포
./scripts/deploy-cloud-run.sh web        # lam-web만 배포
./scripts/deploy-cloud-run.sh --help     # 사용법 출력
```

인자를 생략하면 `all`(전체 배포)로 동작한다. `web` 또는 `admin`만 배포해도 이미 배포되어 있는 `lam-api`의 URL을 조회해서 `API_BASE_URL`로 연결한다 — `lam-api`가 아직 한 번도 배포된 적이 없다면 먼저 `api`를 배포해야 한다.

실행 환경(Windows Git Bash/Cygwin vs Mac/Linux)에 따라 `gcloud` 실행 파일을 자동으로 선택하므로 파일 하나로 양쪽 OS에서 그대로 쓸 수 있다.

### 사전 준비

1. `gcloud` 설치 및 인증
   ```bash
   gcloud auth login
   gcloud config set project lam-production
   ```
2. 아래 Secret Manager 시크릿이 미리 생성되어 있어야 한다. `lam-youtube-api-key`는 선택 항목이며, 없으면 배포는 계속되지만 신청곡 승인은 비활성화된다. `lam-pos-plugin-api-token`은 POS 플러그인 모드를 사용할 때만 필요하다.

   | 시크릿 | 사용하는 서비스 |
   | --- | --- |
   | `lam-database-url` | lam-api |
   | `lam-admin-api-token` | lam-api, lam-admin-web (두 곳 값이 동일해야 함) |
   | `lam-payment-api-token` | lam-api, lam-web (두 곳 값이 동일해야 함) |
   | `lam-supabase-secret-key` | lam-api |
   | `lam-supabase-url` | lam-api |
   | `lam-toss-place-access-key` | lam-api |
   | `lam-toss-place-secret-key` | lam-api |
   | `lam-toss-place-merchant-id` | lam-api |
   | `lam-toss-place-webhook-secret` | lam-api (TossPlace 개발자센터에서 주문 웹훅 등록 시 발급되는 서명 키. 위 `lam-toss-place-secret-key`와 다른 값) |
   | `lam-youtube-api-key` | lam-api (YouTube Data API v3 서버 키) |
   | `lam-pos-plugin-api-token` | lam-api, 매장 POS 플러그인 설정 (플러그인 모드에서만 필요) |
   | `lam-web-session-secret` | lam-web |
   | `lam-staff-entry-token` | lam-web |
   | `lam-qr-signing-secret` | lam-web, lam-api (두 곳 값이 동일해야 함) |
   | `lam-qr-access-token` | lam-web |
   | `lam-customer-test-entry-token` | lam-web |
   | `lam-admin-web-admin-password` | lam-admin-web |
   | `lam-admin-web-session-secret` | lam-admin-web |

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

4. 기본 커스텀 도메인 `www.barlaam.store`의 소유권과 DNS가 확인되어 있어야 한다. 스크립트는 `lam-web` 배포 후 기존 매핑 대상을 확인하고, 매핑이 없으면 생성한다.

### 환경변수로 덮어쓸 수 있는 값

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | `lam-production` | GCP 프로젝트 ID |
| `CLOUD_RUN_API_REGION` | `asia-northeast3` | lam-api 리전 |
| `CLOUD_RUN_WEB_REGION` | `asia-northeast1` | lam-web 리전 |
| `CLOUD_RUN_ADMIN_WEB_REGION` | `asia-northeast3` | lam-admin-web 리전 |
| `CLOUD_RUN_POS_ORDER_PROVIDER` | `open-api` | `plugin`으로 지정하면 API의 Open API 주문 생성을 끄고 POS Worker 플러그인 전달 모드를 활성화한다. 이때 `lam-pos-plugin-api-token` 시크릿이 반드시 있어야 한다 |
| `CLOUD_RUN_WEB_DOMAIN` | `www.barlaam.store` | lam-web 커스텀 도메인. 빈 문자열이면 매핑 확인·생성을 생략하고, lam-api에 넘기는 `CUSTOMER_WEB_BASE_URL`(관리자 테이블 QR이 여는 주소)도 이미 배포된 lam-web의 Cloud Run URL로 대체된다 |
| `CLOUD_RUN_SERVICE_ACCOUNT` | `lam-cloud-run@<project>.iam.gserviceaccount.com` | 모든 Cloud Run 서비스의 실행 서비스 계정 |
| `CLOUD_RUN_NEXT_PUBLIC_SUPABASE_URL` | 현재 운영 Supabase 프로젝트 URL | lam-admin-web 빌드 시점에 번들에 박히는 값 |
| `CLOUD_RUN_NEXT_PUBLIC_SUPABASE_ANON_KEY` | 현재 운영 Supabase anon key | 위와 동일. anon/publishable key는 브라우저에 공개되도록 설계된 값이라 스크립트에 기본값으로 두어도 안전하다(RLS로 보호됨) |

### 배포 후 확인

```bash
gcloud run services describe lam-admin-web --project=lam-production --region=asia-northeast3 --format='value(status.url)'
```

나온 URL 접속 후 `/login` 화면이 뜨는지 확인한다. `web`을 배포한 경우에는 출력된 커스텀 도메인의 `/access-required`에서 고객 테스트 입장 폼도 확인한다.

`api`를 배포했다면 아래까지 확인한다. "배포 성공"은 컨테이너가 떴다는 뜻일 뿐, 시크릿이 의도한 값으로 주입됐는지는 증명하지 않는다.

```bash
API=https://lam-api-yterzctnuq-du.a.run.app

curl -s -o /dev/null -w '%{http_code}\n' "$API/health"                      # 200

# TossPlace 주문 웹훅: 서명이 없으면 401이어야 한다.
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/v1/webhooks/tossplace/orders" \
  -H 'Content-Type: application/json' -d '{"type":"order.order.completed.v1"}'   # 401

# 올바른 서명이면 200이어야 한다. 200이 나오면 Secret Manager의
# lam-toss-place-webhook-secret이 실제로 주입됐고 HMAC 검증이 통과한다는 뜻이다.
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

- **`lam-api` 배포는 됐는데 헬스체크 타임아웃으로 실패하는 경우**: `lam-api`는 HTTP 서버를 띄우기 전에 DB 커넥션과 스키마 마이그레이션을 먼저 수행한다([laam-api/cmd/server/main.go](../laam-api/cmd/server/main.go)). 이 단계가 실패하면 포트 리슨 전에 프로세스가 죽어서 Cloud Run이 "포트 리슨 실패"로 보고한다. 아래로 실제 원인(대부분 `lam-database-url` 시크릿의 DB 비밀번호 불일치)을 확인한다.
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="lam-api"' --project=lam-production --limit=50 --format='value(timestamp,severity,textPayload)' --order=asc
  ```

- **`Permission denied on secret ... /versions/latest`로 revision 생성이 실패하는 경우**: 시크릿은 있지만 `lam-cloud-run` 서비스 계정에 `secretAccessor`가 부여되지 않은 것이다. 새로 만든 시크릿에서 주로 발생한다. 위 "사전 준비" 2번의 `add-iam-policy-binding`을 실행한 뒤 다시 배포한다. 현재 부여 상태는 아래로 확인한다.
  ```bash
  gcloud secrets get-iam-policy <시크릿 이름> --project=lam-production
  ```

- **`gcloud crashed (PermissionError): '.next\dev\lock'`로 소스 업로드가 실패하는 경우**: `gcloud run deploy --source`는 `.dockerignore`가 아니라 `.gcloudignore`를 본다. `laam-admin-web/.gcloudignore`가 빠지거나 잘못되면 로컬 `.next`(1GB 이상)와 `node_modules`까지 업로드되고, 로컬 dev 서버가 떠 있으면 잠긴 파일에서 깨진다. `.gcloudignore`가 있는지 확인하고, 로컬에서 `next dev`나 `next start`를 띄워뒀다면 종료한 뒤 다시 배포한다. `.dockerignore`와 `.gcloudignore`는 같은 의도를 유지해야 하므로 한쪽만 고치지 않는다.

- **`Setting IAM policy failed ... --member=allUsers --role=roles/run.invoker` 경고**: 조직 정책이 `allUsers` 부여를 막을 때 나온다. 이미 공개로 배포된 기존 서비스는 권한이 유지되므로 이 경고만으로는 장애가 아니며, 배포 후 확인 절차에서 외부 요청이 200으로 응답하면 정상이다. 다만 **새 서비스를 처음 배포할 때는 실제로 공개되지 않으므로** 별도로 권한을 부여해야 한다.

- **`deploy-cloud-run.test.sh`를 검증용으로 실행하지 않는다**: 이름과 달리 Windows(Git Bash)에서 실행하면 실제 배포가 수행된다. 이 테스트는 `PATH` 앞에 `gcloud` mock을 놓는데, `deploy-cloud-run.sh`는 `OSTYPE`이 `msys`/`cygwin`이면 `gcloud.cmd`로 분기하므로 mock이 우회된다. 배포 스크립트 변경은 `bash -n`과 diff 확인 같은 정적 검증으로 대신한다.
