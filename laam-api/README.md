# laam-api

`laam-api`는 `laam` QR 메뉴 프로젝트의 백엔드 API 스캐폴드입니다.

메뉴·요청 관리와 손님 주문 등록, 결제 승인, 토스플레이스 POS 동기화를 담당합니다.

## 기술 스택

- Go `1.26`
- 표준 라이브러리 `net/http`

## 현재 구조

```text
laam-api
├─ cmd
│  └─ server
├─ internal
│  ├─ config
│  └─ httpapi
├─ go.mod
└─ README.md
```

## 현재 엔드포인트

- `GET /health`
- `GET /api/v1/menu`
- `POST /api/v1/customer-requests`
- `POST /api/v1/special-requests`
- `POST /api/v1/orders`
- `POST /api/v1/payments/orders`
- `GET /api/v1/payments/orders/{orderId}`
- `POST /api/v1/payments/confirm`
- `POST /api/v1/pos-plugin/orders/claim`
- `POST /api/v1/pos-plugin/orders/{orderId}/complete`
- `POST /api/v1/pos-plugin/orders/{orderId}/fail`
- `POST /api/v1/pos-plugin/tables/claim`
- `POST /api/v1/pos-plugin/tables/{syncId}/complete`
- `POST /api/v1/pos-plugin/tables/{syncId}/fail`
- `GET /api/v1/pos-plugin/table-mappings`
- `GET|POST /api/v1/admin/tables`
- `POST /api/v1/admin/tables/pos-sync`
- `GET /api/v1/admin/tables/pos-sync/{syncId}`
- `PATCH /api/v1/admin/tables/{qrTableId}/pos-link`
- `POST /api/v1/admin/song-requests/{requestId}/approve`
- `GET /api/v1/admin/song-player/queue`
- `PATCH /api/v1/admin/song-player/queue/{queueId}/status`
- `GET|POST /api/v1/admin/expense-categories`
- `PATCH /api/v1/admin/expense-categories/{id}`
- `GET|POST /api/v1/admin/inventory-items`
- `PATCH /api/v1/admin/inventory-items/{id}`
- `POST /api/v1/admin/inventory-items/{id}/adjust`
- `GET /api/v1/admin/inventory-items/{id}/adjustments`
- `GET /api/v1/admin/inventory/summary`
- `GET|POST /api/v1/admin/expense-receipts`
- `GET|PATCH|DELETE /api/v1/admin/expense-receipts/{id}`
- `POST|DELETE /api/v1/admin/expense-receipts/{id}/image`
- `GET /api/v1/admin/expense-receipts/{id}/image-url`
- `GET /api/v1/admin/expenses/summary`

## 실행 방법

```bash
go run ./cmd/server
```

기본 주소:

```text
http://localhost:9090
```

로컬에서는 저장소 루트 `.env` 또는 `laam-api/.env.local`의 API 환경변수를
`go run` 실행 시 자동으로 읽습니다. Supabase PostgreSQL을 사용하려면 해당
파일에 연결 문자열을 설정합니다. 이미 셸에 설정된 환경변수는 덮어쓰지
않습니다.

```bash
DATABASE_URL='postgresql://postgres.<PROJECT_REF>:[YOUR-PASSWORD]@aws-0-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require'
```

손님 주문을 토스 POS에 등록하려면 다음 값을 환경변수로 설정합니다. 키는 저장소에 커밋하지 않습니다.

```bash
PAYMENT_API_TOKEN=웹과_API가_공유할_긴_임의값
TOSS_PLACE_ACCESS_KEY=토스플레이스_오픈API_액세스키
TOSS_PLACE_SECRET_KEY=토스플레이스_오픈API_시크릿키
TOSS_PLACE_MERCHANT_ID=토스플레이스_가맹점_ID
```

`POST /api/v1/orders`는 결제 내역 없이 후불 주문을 토스 POS에 생성합니다. 손님은 매장에서 별도로 결제합니다. 토스페이먼츠 결제 기능을 별도로 사용할 때만 `TOSS_PAYMENTS_SECRET_KEY`가 필요합니다.

일반·특별 요청 접수(`POST /api/v1/customer-requests`, `POST /api/v1/special-requests`)도 `Authorization: Bearer <PAYMENT_API_TOKEN>`이 필요합니다. 토큰이 없거나 일치하지 않으면 `401`을 반환합니다. 브라우저는 QR 세션을 검사하는 `laam-web`의 각 요청 API를 통해 접수하며, 일반·특별 요청 저장 흐름은 분리되어 있습니다. 운영에서는 개발용 기본값 대신 웹과 API에 동일한 비밀 토큰을 설정하세요. 기존 웹과 호환되도록 인증 헤더를 보내는 웹 버전을 먼저 배포한 뒤 API를 배포합니다.

기본 `POS_ORDER_PROVIDER=open-api`는 토스플레이스 Open API 주문을 생성합니다. 이 방식의 주문은 POS 주문 목록에는 들어가지만 내부 `tableId`를 지정할 수 없어 POS 테이블 카드에 연결되지 않습니다. 매장 POS의 테이블에 직접 주문을 붙이려면 `laam-pos-plugin`을 먼저 설치·설정한 뒤 API를 다음처럼 전환합니다.

```bash
POS_ORDER_PROVIDER=plugin
POS_PLUGIN_API_TOKEN=플러그인과_API가_공유할_별도의_긴_임의값
```

`plugin` 모드에서는 Open API 주문 생성을 건너뛰고 주문을 `PENDING`으로 보관합니다. POS 플러그인이 전용 Bearer 토큰으로 주문 한 건을 가져가 실제 토스 테이블을 찾은 다음, 빈 테이블에는 신규 주문을 만들고 진행 중 주문이 있는 테이블에는 메뉴만 추가합니다. 플러그인 설치 전에는 이 모드를 켜지 마세요. 설정과 패키징 방법은 [`../laam-pos-plugin/README.md`](../laam-pos-plugin/README.md)를 참고합니다.

QR 테이블(`T-01`, `B-03`)과 POS 테이블(토스 내부 숫자 id)의 연결은 관리자 테이블 화면에서 관리합니다. 관리자가 `POST /api/v1/admin/tables/pos-sync`로 동기화를 요청하면 POS 플러그인이 `POST /api/v1/pos-plugin/tables/claim`으로 가져가 매장 테이블 목록을 올리고, 서버가 기존 스냅샷을 통째로 교체한 뒤 이름 규칙(`t11`·`테이블 11` → `T-11`, `바3`·`바자리3` → `B-03`)으로 아직 연결되지 않은 테이블을 자동 연결합니다. 후보가 둘 이상이면 연결하지 않고 관리자가 지정합니다. 30초 안에 플러그인이 응답하지 않으면 요청은 `TIMED_OUT`이 됩니다.

연결이 하나라도 있으면 주문 생성(`POST /api/v1/orders`, `POST /api/v1/payments/orders`)은 연결된 QR 테이블에서만 허용하고, 그 외에는 `400`과 `{"error": "table is not linked to POS", "code": "table_not_linked"}`를 반환합니다. 연결이 하나도 없으면 이 검사를 건너뛰므로 플러그인 배포 전 동작은 그대로입니다. 일반·특별 요청과 노래 신청은 이 검사의 영향을 받지 않습니다.

토스플레이스가 설정되어 있으면 API 시작 시 POS 카탈로그를 한 번 동기화합니다. 이후 변경 사항은 관리자 메뉴의 `다시 동기화` 버튼으로 반영합니다.

- 상품명, 설명, 가격, 판매 상태와 토스 상품 ID는 POS를 원본으로 사용합니다. 설명의 ABV 줄(숫자만 있는 도수 표기 포함)은 설명에서 빼고 `ABV : n%` 라벨로 노출합니다.
- 토스 상품 이미지, 첫 번째 라벨과 옵션·선택지도 함께 가져와 손님 메뉴에 노출합니다. 동기화된 라벨의 색상은 모두 기본값(녹색)으로 맞춥니다.
- 손님이 선택한 옵션은 서버에서 필수 여부, 선택 개수, 수량과 추가 금액을 다시 검증한 뒤 토스 POS 주문의 `optionChoices`로 전달합니다.
- 기존 `lam` 메뉴와 이름이 일치하면 수동 이미지를 유지하며, 토스 라벨이 없을 때는 기존 뱃지도 유지한 채 연결합니다. 설명은 POS의 최신 문구로 갱신합니다.
- 신규 POS 상품은 `시그니처 / 하이볼 / 위스키 / 칵테일 / 논알콜` 웹 카테고리에 자동 분류합니다.
- POS에서 사라진 상품, 품절 상품, 0원 상품은 손님 화면에서 숨깁니다.
- 손님 주문은 임의 상품이 아닌 연결된 POS 상품 ID로 생성합니다.

신청곡 자동 재생을 사용하려면 서버 실행 환경에 YouTube Data API v3 키를 추가합니다. 키는 관리자 웹에 노출하지 않습니다.

```bash
YOUTUBE_API_KEY=서버용_YouTube_Data_API_v3_키
```

관리자가 노래 신청을 승인하면 API가 임베드 가능한 영상을 검색해 재생 대기열에 저장합니다. 관리자 웹의 `/player` 화면은 대기열을 순서대로 재생하고 완료 상태를 API에 반영합니다.

재고·지출 관리의 영수증 사진은 Supabase Storage 비공개 버킷에 저장합니다. `SUPABASE_URL`을 재사용하고 서버 전용 secret key와 버킷 이름을 설정합니다. 버킷은 API가 만들지 않으므로 배포 시 비공개 버킷으로 미리 생성합니다. 키가 없으면 영수증 이미지 엔드포인트만 `503`을 반환합니다.

```bash
SUPABASE_STORAGE_KEY=서버용_Supabase_secret_key
EXPENSE_RECEIPT_BUCKET=expense-receipts
```

## 구현 메모

- `cmd/server/main.go`에서 HTTP 서버를 기동합니다.
- `internal/config`에서 기본 실행 설정을 불러옵니다.
- `internal/httpapi/router.go`에서 라우트를 연결합니다.
- 결제 주문 금액은 요청 본문이 아니라 DB에 저장된 메뉴 가격으로 생성하고 승인 시 다시 대조합니다.
- `15,000원~`처럼 금액이 확정되지 않은 메뉴는 온라인 결제 주문을 만들지 않습니다.

## 검증 내역

아래 항목을 확인했습니다.

- `go build ./...`
