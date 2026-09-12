# scripts

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
   | `lam-youtube-api-key` | lam-api (YouTube Data API v3 서버 키) |
   | `lam-pos-plugin-api-token` | lam-api, 매장 POS 플러그인 설정 (플러그인 모드에서만 필요) |
   | `lam-web-session-secret` | lam-web |
   | `lam-staff-entry-token` | lam-web |
   | `lam-qr-signing-secret` | lam-web, lam-api (두 곳 값이 동일해야 함) |
   | `lam-qr-access-token` | lam-web |
   | `lam-customer-test-entry-token` | lam-web |
   | `lam-admin-web-admin-password` | lam-admin-web |
   | `lam-admin-web-session-secret` | lam-admin-web |

   없는 시크릿은 아래처럼 생성한다.
   ```bash
   printf '%s' '<값>' | gcloud secrets create <시크릿 이름> --data-file=- --project=lam-production
   ```
   이미 있는 시크릿의 값을 바꿀 때는 `create` 대신 `versions add`를 쓴다.
   ```bash
   printf '%s' '<새 값>' | gcloud secrets versions add <시크릿 이름> --data-file=- --project=lam-production
   ```

3. 모든 서비스는 기본적으로 `lam-cloud-run@lam-production.iam.gserviceaccount.com` 서비스 계정을 사용한다. 이 계정에 필요한 시크릿 접근 권한(`roles/secretmanager.secretAccessor`)이 있어야 한다.

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

### 알려진 문제

- **`lam-api` 배포는 됐는데 헬스체크 타임아웃으로 실패하는 경우**: `lam-api`는 HTTP 서버를 띄우기 전에 DB 커넥션과 스키마 마이그레이션을 먼저 수행한다([lam-api/cmd/server/main.go](../lam-api/cmd/server/main.go)). 이 단계가 실패하면 포트 리슨 전에 프로세스가 죽어서 Cloud Run이 "포트 리슨 실패"로 보고한다. 아래로 실제 원인(대부분 `lam-database-url` 시크릿의 DB 비밀번호 불일치)을 확인한다.
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="lam-api"' --project=lam-production --limit=50 --format='value(timestamp,severity,textPayload)' --order=asc
  ```
