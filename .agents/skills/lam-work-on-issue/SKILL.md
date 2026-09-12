---
name: lam-work-on-issue
description: Use when implementing a lam feature, bug fix, refactoring, behavior change, or a GitHub Issue that requires branch selection, TDD, focused verification, and current-document synchronization.
---

# lam 변경 작업

## 시작 조건

1. 요청의 목표, 완료 조건, 위험과 수정 범위를 확인한다.
2. Issue가 제공되면 번호, 상태와 완료 조건을 확인한다. Issue 생성이나 Milestone 배정은 사용자 요청 없이 수행하지 않는다.
3. 루트와 변경 경로에서 가장 가까운 `AGENTS.md`를 읽는다.
4. 현재 브랜치와 working tree를 확인하고 다른 개발자의 변경을 보존한다.

## 작업 위치 선택

| 변경 | 작업 위치 |
| --- | --- |
| 작은 격리 변경 | 본인 dev 브랜치 (`ino/dev` 또는 `ms/dev`) |
| 장기·병렬·고위험 작업 | 최신 본인 dev 브랜치에서 분기한 feature branch |
| 공개 API, DB migration, 인증·인가 변경 | 최신 본인 dev 브랜치에서 분기한 feature branch |

feature branch가 필요하면 작업 전에 이유, 기준 브랜치와 제안 브랜치명을 알린다. 새 branch는 사용자가 해당 생성을 명시적으로 승인한 후에만 만들며, 기능 구현이나 branch 전환 요청을 생성 승인으로 간주하지 않는다.

이 feature branch는 본인 dev 브랜치로 병합하기 위한 작업용 branch다. `main`으로의 전달은 이 작업용 branch를 직접 사용하지 않고, 병합이 끝난 본인 dev 브랜치에서 `main`으로 Pull Request를 열어 진행한다(`lam-deliver-change` Skill 참고).

## TDD

기능, 버그 수정, 리팩터링 또는 실행 동작 변경에는 다음 순서를 적용한다.

1. 기대 동작 하나를 보여주는 최소 테스트를 먼저 작성한다.
2. 테스트를 실행해 구현 누락이나 대상 결함 때문에 실패하는 RED를 확인한다.
3. 테스트를 통과시키는 최소 구현만 작성한다.
4. 같은 테스트를 다시 실행해 GREEN을 확인한다.
5. 필요한 경우에만 리팩터링하고 영향받는 회귀 테스트를 다시 실행한다.

테스트가 처음부터 통과하거나 오타·환경 문제로 실패하면 유효한 RED가 아니다. 구현을 먼저 작성했다면 그 작업을 TDD라고 보고하지 않는다.

## 단순 변경

런타임 동작과 계약에 영향이 없는 문구, 주석, 순수 문서, 비동작 메타데이터 변경에는 인위적인 테스트를 만들지 않는다. 다음만 수행한다.

- 변경 diff 확인
- 링크, 형식 또는 문법처럼 실제 의미가 있는 검증이 있으면 해당 검사 실행
- 자동 테스트를 생략한 이유 보고

CSS, 라우팅, 환경변수, 설정, 타입, 의존성 변경은 단순 변경으로 취급하지 않는다.

## 완료 전 검증

완료를 말하기 전에 다음 순서를 지킨다.

1. 각 완료 주장에 필요한 검증 명령을 식별한다.
2. 변경 범위에 맞는 최신 검증을 실행한다.
3. 전체 출력, 종료 코드와 실패 수를 확인한다.
4. 실패하면 성공으로 표현하지 않고 실제 상태와 원인을 보고한다.
5. 실행하지 못한 검증과 이유를 명시한다.
6. CI가 있는 경로를 변경했으면 push 전에 `lam-verify-ci` Skill로 CI 동등 검증을 실행한다.
   - `lam-api`: 워킹트리가 CRLF라 `gofmt -l .`을 그대로 실행하면 모든 파일이 오탐으로 출력되므로, 그 Skill의 LF 기준 절차를 사용한다.
   - `lam-admin-web`: 의존성 설치는 `npm install`이 아니라 CI와 같은 `npm ci`로 확인한다. `package.json`이나 `package-lock.json`을 건드렸다면 Windows에서 만든 lockfile이 리눅스 러너에서 `npm ci`를 깨뜨리는 함정이 있으므로 그 Skill의 절차를 따른다. UI 상호작용을 바꿨다면 `npm run test:e2e`까지 확인한다.
   - `lam-web`에는 CI가 없다. 로컬 검증 결과만이 근거이므로 무엇을 실행했는지 보고에 명시한다.

테스트 통과는 테스트 결과만, 빌드 성공은 빌드 결과만 증명한다. 부분 검증을 전체 성공으로 확대 해석하지 않는다.

## 문서 동기화

- 변경된 현재 사용법과 계약에 영향을 주는 README, API 설명, 설정 예시, 아키텍처 문서, `AGENTS.md`, Skill만 함께 갱신한다.
- 영향이 없으면 문서를 억지로 변경하지 않고 그 판단을 완료 보고에 남긴다.
- changelog, 작업 일지, Phase 완료 요약, 검증 이력을 자동 생성하지 않는다.

## Git 작업

- commit, push, merge는 사용자가 요청한 경우에만 수행한다.
- 한 논리 변경을 한 커밋으로 묶고 `type: 한글 변경사항` 형식을 사용한다.
- Issue 번호가 확인되면 커밋 본문에 `Refs: #번호`를 사용한다.
- feature branch는 본인 dev 브랜치에서 시작해 본인 dev 브랜치로만 전달한다. `main`으로 직접 PR하지 않는다.
- 충돌은 feature branch에서 해결하고 검증한 뒤 전달한다.

## 중단 조건

- 기존 변경을 덮어쓰거나 삭제해야 한다.
- 다른 개발자와 같은 파일 또는 계약에서 충돌한다.
- 필요한 브랜치, 완료 조건 또는 검증 방법이 확인되지 않았다.
- 테스트 실패를 해결하지 못했거나 필수 검증을 실행할 수 없다.
- force push, history rewrite 또는 파괴적 데이터 변경이 필요하다.
