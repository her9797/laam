# laam-admin-web

`laam-admin-web`은 `lam` QR 메뉴 프로젝트의 운영자용 관리자 웹입니다.

카테고리·메뉴·이벤트 관리, 손님 요청(`바로 전달하기`/`특별한`) 확인을 위한 관리자 전용 화면을 제공합니다. 기존 `laam-web` 내부의 관리자 UI는 이 프로젝트와 별개로 그대로 유지되며, 두 관리자 화면 중 하나를 선택적으로 사용할 수 있습니다.

## 기술 스택

- Next.js `16.3.4`
- React `19.2.8`
- TypeScript
- `@tanstack/react-query`
- `shadcn` / `@base-ui/react`
- `vitest`, `playwright`

## 환경변수

`.env.example`을 복사해 `.env.local`을 만들고 값을 채웁니다.

```bash
cp .env.example .env.local
```

| 변수 | 설명 |
| --- | --- |
| `ADMIN_PASSWORD` | 관리자 로그인 비밀번호. 운영 환경에서는 반드시 강력한 값으로 교체한다. |
| `SESSION_SECRET` | 로그인 세션 서명용 비밀키. 운영 환경에서는 충분히 긴 임의 문자열로 교체한다. |
| `ADMIN_API_TOKEN` | `laam-api` 관리자 API 호출용 Bearer 토큰. `laam-api`의 `ADMIN_API_TOKEN`과 반드시 동일해야 한다. |
| `API_BASE_URL` | `laam-api` 서버 주소. 로컬 `npm run dev`/`npm run start` 실행 시 사용하며, 기본값은 `http://localhost:9090`이다. |

이 네 값은 실제 운영 값을 커밋하지 않는다. `.env.local`은 `.gitignore`에 의해 커밋 대상에서 제외된다.

## 로컬 실행

`laam-api`가 먼저 실행 중이어야 합니다(루트 `README.md`의 "로컬 실행 방법" 참고).

```bash
npm install
npm run dev
```

접속 주소:

```text
http://localhost:3000
```

로그인 화면은 `/login`이며, `.env.local`의 `ADMIN_PASSWORD`로 로그인합니다.

## Docker 실행

단독 이미지 빌드:

```bash
docker build -t laam-admin-web:local .
```

컨테이너 실행(예시, `laam-api`가 별도로 `http://localhost:9090`에서 실행 중인 경우):

```bash
docker run --rm -p 3001:8080 \
  -e API_BASE_URL=http://host.docker.internal:9090 \
  -e ADMIN_API_TOKEN=laam-admin-api-token \
  -e ADMIN_PASSWORD=laam-admin-dev-password \
  -e SESSION_SECRET=laam-admin-dev-session-secret-change-me \
  laam-admin-web:local
```

전체 스택(PostgreSQL·`laam-api`·`laam-web`·`laam-admin-web`)을 함께 띄우는 방법은 루트 `README.md`의 "Docker Compose 실행" 항목을 참고하세요.

## 스크립트

```bash
npm install
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run test
npm run test:e2e
```

## 검증 내역

아래 항목을 확인했습니다.

- `docker compose config`
- `docker build -t laam-admin-web:local laam-admin-web`
- `docker compose up -d --build` 후 `docker compose ps`로 4개 서비스 기동 확인, `http://localhost:3001/login` HTTP 200 확인, `docker compose down`으로 정리
