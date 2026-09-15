# lam-web

`lam-web`은 `laam` QR 메뉴 프로젝트의 손님용 모바일 웹 프론트엔드입니다.

손님이 QR을 스캔했을 때 가장 먼저 보게 되는 화면이며, 메뉴 확인과 요청사항/이벤트 안내를 빠르게 소비할 수 있도록 모바일 우선으로 구성했습니다.

## 기술 스택

- Next.js `16.3.0`
- React `19.2.0`
- React DOM `19.2.0`
- TypeScript `5.9.2`
- ESLint `9.34.0`
- `eslint-config-next` `16.3.0`
- `@types/node` `24.3.0`
- `@types/react` `19.2.2`
- `@types/react-dom` `19.2.2`

## 스크립트

```bash
npm install
npm run dev
npm run build
npm run start
npm run lint
npm test
```

## 주요 라우트

- `/`: 메인 화면
- `/menu`: 메뉴 메인 화면
- `/menu/[category]`: 카테고리별 메뉴 상세
- `/requests`: 요청사항 안내 화면
- `/events`: 공지 및 이벤트 화면
- `/test/enter`: 테스트 환경용 고객 세션 진입점

## 디렉토리 구조

```text
lam-web
├─ app
├─ components
│  ├─ menu
│  ├─ navigation
│  └─ screens
├─ data
├─ services
├─ public
└─ README.md
```

## 구현 메모

- Next.js App Router를 사용합니다.
- 공통 UI는 역할 기준으로 분리해 유지보수성을 높였습니다.
- 목 메뉴 데이터는 `data/menu-data.ts`에 있습니다.
- 메뉴 선택 및 조회 로직은 `services/menu-service.ts`에 있습니다.
- 전역 스타일 토큰과 레이아웃 관련 규칙은 `app/globals.css`에 모아뒀습니다.
- 데스크톱보다 QR 진입형 모바일 브라우징 경험에 맞춰 UI를 구성했습니다.

## 로컬 실행

```bash
npm install
npm run dev
```

접속 주소:

```text
http://localhost:3000
```

고객 화면은 QR 세션이 필요합니다. 로컬 또는 테스트 환경에서 QR 없이 확인하려면 `.env.local`에 임의의 긴 토큰을 설정합니다.

```bash
CUSTOMER_TEST_ENTRY_TOKEN=로컬에서만_사용할_긴_임의값
```

서버를 다시 실행한 뒤 아래 주소로 접속하면 기본 테이블 `T-01` 고객 세션이 발급됩니다.

`/access-required` 화면에도 테스트 입장 폼이 표시되므로, 토큰과 테이블을 직접 입력해 입장할 수 있습니다.

```text
http://localhost:3000/test/enter?key=로컬에서만_사용할_긴_임의값
```

다른 테이블로 확인하려면 `table`을 추가합니다. 허용 범위는 `T-01`~`T-12`, `B-01`~`B-05`입니다.

```text
http://localhost:3000/test/enter?key=로컬에서만_사용할_긴_임의값&table=B-03
```

`CUSTOMER_TEST_ENTRY_TOKEN`을 비워 두면 테스트 진입은 비활성화됩니다. 실제 운영 환경에는 이 값을 설정하지 않는 것을 권장합니다.

메뉴 주문 및 일반·특별 요청 접수에는 `lam-web/.env.local`에 API가 공유할 내부 토큰을 설정합니다.

```bash
PAYMENT_API_TOKEN=lam-api와_동일한_긴_임의값
```

`POST /api/customer-requests`와 `POST /api/special-requests`는 유효한 QR 세션이 없으면 `401`을 반환합니다. 인증된 요청만 서버 전용 `PAYMENT_API_TOKEN`을 붙여 각각의 Go API로 전달합니다. 이 토큰을 브라우저에 노출하지 마세요.

토스플레이스 키는 반드시 `lam-api`에서만 관리합니다. 메뉴의 주문 버튼은 결제창을 열지 않고 후불 주문을 POS에 등록하며, 결제는 매장에서 진행합니다.

## 검증 내역

아래 항목을 확인했습니다.

- `npm run build`
- `npm run lint`
