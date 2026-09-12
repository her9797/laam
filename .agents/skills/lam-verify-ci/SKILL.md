---
name: lam-verify-ci
description: Use when a lam CI workflow fails (lam-api CI or lam-admin-web CI), or before pushing lam-api/lam-admin-web changes, to reproduce the GitHub Actions checks locally and confirm the real cause of a failed run.
---

# lam CI 검증

저장소의 CI workflow가 실행하는 검사를 로컬에서 재현하고, 실패한 run의 원인을 확정한다. 추측한 원인을 확정된 원인으로 보고하지 않는다.

| workflow | 파일 | 대상 경로 |
| --- | --- | --- |
| `lam-api CI` | `.github/workflows/lam-api-ci.yml` | `lam-api/**` |
| `lam-admin-web CI` | `.github/workflows/lam-admin-web-ci.yml` | `lam-admin-web/**` |

두 workflow 모두 `paths` 필터가 있어 해당 디렉터리를 건드리지 않은 push에서는 아예 실행되지 않는다. "CI가 초록색"이 곧 "내 변경이 검증됐다"는 뜻이 아니므로, 변경 경로에 맞는 workflow가 실제로 돌았는지 먼저 확인한다.

`lam-web`에는 CI가 없다. 이 저장소에서 `lam-web` 변경은 자동 검증되지 않으므로 로컬 검증 결과만이 근거다.

# lam-api CI

## CI가 실행하는 검사

working directory는 `lam-api`이며, 순서대로 실행되고 앞 단계가 실패하면 뒤 단계는 실행되지 않는다.

| 단계 | 명령 | 실패 조건 |
| --- | --- | --- |
| 코드 포맷 검사 | `gofmt -l .` | 출력이 비어 있지 않음 |
| 정적 분석 | `go vet ./...` | 종료 코드 != 0 |
| 빌드 | `go build ./...` | 종료 코드 != 0 |
| 테스트 | `go test ./... -v -count=1` | 종료 코드 != 0 |

Go 버전은 `lam-api/go.mod`의 `go` 지시자를 따른다. 로컬 Go 버전이 다르면 그 사실을 보고에 남긴다.

## 줄바꿈 함정 (재현 전에 반드시 확인)

저장소에 `.gitattributes`가 없고 Windows 개발 환경은 `core.autocrlf=true`다. 그래서 워킹트리의 `.go` 파일은 CRLF이고, `lam-api`에서 `gofmt -l .`을 그대로 실행하면 **모든** `.go` 파일이 위반으로 출력된다. 전부 오탐이며 진짜 위반 파일이 그 목록에 묻힌다.

CI는 LF 체크아웃에서 실행되므로 로컬 검증도 LF 기준으로 맞춘다. `git config --get core.autocrlf`로 현재 설정을 먼저 확인한다.

## 로컬 재현

### 워킹트리 기준 (커밋 전)

```bash
cd lam-api
for f in $(git ls-files '*.go'); do
  if ! diff -q <(tr -d '\r' < "$f") <(tr -d '\r' < "$f" | gofmt) >/dev/null 2>&1; then
    echo "UNFORMATTED: $f"
  fi
done
go vet ./...
go build ./...
```

출력된 파일만 `gofmt -w <파일>`로 정리한다. 정리 후 `git diff`로 변경 줄이 의도한 정렬뿐인지 확인한다. 파일 전체가 변경으로 보이면 LF 재작성이 diff에 새어 나온 것이므로 커밋하지 않고 중단한다.

### 커밋 기준 (push 전, CI와 가장 가까움)

```bash
TMP=$(mktemp -d)
git -c core.autocrlf=false archive HEAD lam-api | tar -x -C "$TMP"
cd "$TMP/lam-api" && gofmt -l . && go vet ./... && go build ./...
```

`-c core.autocrlf=false`를 빼면 `git archive`가 CRLF로 변환해 위의 오탐이 그대로 재현된다. 특정 run을 재현할 때는 `HEAD` 대신 그 run의 head SHA를 넣는다.

### 테스트

`internal/store`와 `internal/httpapi`의 통합 테스트는 `TestMain`이 `docker run`으로 `postgres:16-alpine`을 직접 기동·정리한다. CI 러너는 Docker를 기본 제공하므로 workflow에 별도 service 컨테이너가 없다.

- Docker가 PATH에 없으면 해당 패키지는 컨테이너를 띄우지 않고 `os.Exit(0)`으로 조용히 통과한다. 이 통과는 통합 테스트 통과가 아니다.
- 통합 테스트까지 확인하려면 Docker를 실행한 뒤 `go test ./... -count=1`을 돌리고, 출력에 `docker not found in PATH`가 없는지 확인한다.
- Docker 없이 확인한 결과를 CI 테스트 단계 통과 근거로 사용하지 않는다.

# lam-admin-web CI

## CI가 실행하는 검사

working directory는 `lam-admin-web`이며 job 두 개가 **병렬로** 실행된다. 한쪽이 실패해도 다른 쪽은 계속 돈다.

| job | 단계 | 명령 |
| --- | --- | --- |
| 정적 검사와 단위 테스트 | 의존성 설치 | `npm ci` |
| | 타입 검사 | `npm run typecheck` |
| | 린트 | `npm run lint` |
| | 단위·컴포넌트 테스트 | `npm run test` (vitest) |
| E2E 테스트 | 의존성 설치 | `npm ci` |
| | 브라우저 설치 | `npx playwright install --with-deps chromium` (캐시 적중 시 `install-deps`만) |
| | E2E | `npm run test:e2e` (playwright) |

`gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion // .status)"'`로 job별 결과를 먼저 본다. run 전체가 `failure`여도 어느 job이 죽었는지에 따라 원인이 전혀 다르다.

## npm ci 함정 (Windows에서 lockfile을 만들었을 때)

`npm ci`가 아래처럼 실패하면 코드 문제가 아니라 lockfile 문제다.

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and package-lock.json ... are in sync
npm error Missing: @emnapi/runtime@1.11.3 from lock file
```

Windows의 npm은 현재 플랫폼에 해당하지 않는 optional 의존성을 ideal tree에서 제외하므로, Windows에서 `npm install`로 만든 lockfile에는 리눅스 러너가 요구하는 항목(`@img/sharp-wasm32`가 끌어오는 `@emnapi/runtime`, `@tailwindcss/oxide-wasm32-wasi`가 끌어오는 `@emnapi/core` 등)이 최상위 항목으로 들어가지 않는다. 로컬에서는 `npm ci`를 쓸 일이 없어 드러나지 않는다.

**`--os=linux --cpu=x64` 플래그로는 해결되지 않는다.** 확인된 방법은 리눅스 컨테이너 안에서 재생성하는 것뿐이다.

```bash
cd lam-admin-web
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "/c/ino-dev/workspace/lam/lam-admin-web:/app" -w /app \
  node:24-bookworm-slim bash -c "npm install --package-lock-only --ignore-scripts"
```

`MSYS_NO_PATHCONV=1`이 없으면 Git Bash가 `/app`을 Windows 경로로 바꿔 `working directory ... is invalid`로 실패한다.

재생성 후 diff를 반드시 확인한다. 정상이면 **추가만 있고 삭제 0줄**, 기존 패키지 버전 변동 없음, `package.json` 무변경이다. 삭제되거나 버전이 바뀐 항목이 있으면 의도치 않은 업그레이드이므로 커밋하지 않는다.

```bash
git diff --stat -- lam-admin-web/package-lock.json
git diff -- lam-admin-web/package-lock.json | grep -cE '^-    "node_modules/'   # 0이어야 한다
```

## 로컬 재현

```bash
cd lam-admin-web
npm ci            # CI와 동일하게 lockfile 기준 설치 (npm install 아님)
npm run typecheck
npm run lint
npm run test
```

`npm install`로 재현하면 위의 lockfile 불일치가 감춰진다. lockfile 관련 실패를 재현할 때는 반드시 `npm ci`를 쓴다.

### E2E

```bash
cd lam-admin-web
npx playwright install chromium   # 최초 1회
npm run test:e2e
```

- E2E는 `lam-api`를 호출하지 않는다. `playwright.config.ts`의 `webServer`가 도달 불가능한 `API_BASE_URL`을 넘기고 `tests/e2e/fixtures.ts`가 `/api/admin/*`를 `page.route`로 가로챈다. 따라서 DB도 백엔드도 띄울 필요가 없다.
- 모킹에 구멍이 있으면 연결 거부로 요란하게 실패한다. 이는 의도된 설계이므로 "서버를 안 띄워서 실패했다"로 해석하지 않는다.
- `webServer`가 `npm run build`부터 수행하므로 로컬에서도 수 분이 걸린다.
- CI에서는 `forbidOnly`가 켜져 `test.only`가 남아 있으면 실패한다. 재시도는 2회다.
- 실패 시 `lam-admin-web-playwright-report` artifact에 리포트가 올라간다.

```bash
gh run download <run-id> --name lam-admin-web-playwright-report
```

# 실패한 run 진단

```bash
gh run list --branch <브랜치> --limit 5
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion // .status)"'
gh run view <run-id> --log-failed
gh run view <run-id> --json headSha --jq .headSha
```

`--log-failed`는 npm 실패 시 사용법 도움말을 길게 쏟아내 진짜 원인이 묻힌다. `grep -i "npm error" | head`로 상단 몇 줄만 보면 `code`와 원인 문장이 바로 나온다.

## lam-api 전용

`코드 포맷 검사 (gofmt)` 단계는 위반 파일 목록을 stdout이 아니라 `$GITHUB_STEP_SUMMARY`에만 기록한다. 따라서 `--log-failed`에는 `Process completed with exit code 1`만 남고 파일명은 나오지 않는다. `gh api repos/<owner>/<repo>/actions/jobs/<job-id>` 응답에도 step summary는 없다. 이 경우 위 "커밋 기준" 재현으로 파일 목록을 직접 얻는다.

테스트 단계 실패는 `lam-api-test-log` artifact(`test-output.log`)에 전체 출력이 있다.

```bash
gh run download <run-id> --name lam-api-test-log
```

# 보고

- 실패한 run id, workflow 이름, 실패한 job과 단계
- 확정한 원인과 해당 파일·줄
- 재현에 사용한 명령과 그 결과
- 실행하지 못한 검사와 이유 (예: Docker 미실행으로 통합 테스트 미검증)

# 중단 조건

- 로컬 재현 결과가 CI 실패 단계와 일치하지 않는다.
- 실패 원인이 다른 개발자의 미커밋 변경 또는 소유 브랜치에 있다.
- 수정에 workflow 파일 변경이 필요하다.
- 실패 단계가 테스트인데 Docker를 실행할 수 없어 결과를 확인할 수 없다.

# 배포 스크립트를 CI 검증에 쓰지 않는다

`scripts/deploy-cloud-run.test.sh`는 이름과 달리 **Windows(Git Bash)에서 실행하면 실제 Cloud Run 배포를 수행한다.** 이 테스트는 `PATH` 앞에 `gcloud`라는 이름의 mock을 놓아 가로채는데, `scripts/deploy-cloud-run.sh`는 `OSTYPE`이 `msys`/`cygwin`일 때 `GCLOUD=gcloud.cmd`로 분기하므로 mock이 적용되지 않고 진짜 `gcloud.cmd`가 호출된다. 실제로 이 스크립트를 검증 목적으로 돌렸다가 `lam-web`이 운영에 배포된 사례가 있다.

배포 스크립트 변경을 검증할 때는 이 스크립트를 실행하지 말고 정적으로 확인한다(`bash -n`, 변경된 인자 문자열 `grep`). 리눅스에서는 mock이 정상 동작하지만, 그 사실을 근거로 Windows에서 실행하지 않는다.

# 관련 Skill

- 원인을 고치는 작업은 `lam-work-on-issue`의 TDD와 완료 전 검증을 따른다.
- `main` 전달 전 CI 상태 확인은 `lam-deliver-change`에서 이 Skill을 호출한다.
