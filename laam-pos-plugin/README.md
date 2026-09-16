# laam-pos-plugin

`laam-pos-plugin`은 손님 웹 주문을 토스 POS의 실제 테이블 주문에 연결하는 백그라운드 Worker 플러그인입니다. `laam-api`에서 대기 주문을 한 건씩 가져오고, POS 내부 테이블과 카탈로그를 조회해 다음처럼 처리합니다.

- 대상 테이블에 진행 중 주문이 없으면 `posPluginSdk.order.add`로 테이블 주문 생성
- 진행 중 주문이 있으면 `posPluginSdk.order.addMenu`로 새 메뉴만 추가
- POS 등록 직후 처리 결과를 보안 저장소에 기록해 API 응답 유실·POS 재시작 시 중복 등록 방지
- 실패한 주문은 API에 오류를 남기고 2분 뒤 다시 시도

## 로컬 검증과 패키징

```bash
npm install
npm test
npm run typecheck
npm run build
npm run zip
```

업로드 파일은 `laam-pos-plugin/laam-pos-plugin.zip`에 생성됩니다.

## 설치 순서

1. 충분히 긴 임의 토큰을 만들고 Google Secret Manager의 `laam-pos-plugin-api-token`에 저장합니다. 토큰을 저장소나 채팅에 남기지 않습니다.
2. API를 플러그인 모드로 배포합니다.

   ```bash
   CLOUD_RUN_POS_ORDER_PROVIDER=plugin bash scripts/deploy-cloud-run.sh api
   ```

3. 토스플레이스 개발자센터의 플러그인에서 Worker 패키지를 만들고 `laam-pos-plugin.zip`을 개발 버전으로 업로드합니다.
4. 플러그인 ACL에 배포된 `laam-api`의 HTTPS origin을 등록하고 테스트 POS 기기에 플러그인을 설치합니다.
5. POS의 플러그인 설정에 아래 값을 입력합니다.

   - `laam-api 주소`: Cloud Run의 `laam-api` URL
   - `POS 플러그인 API 토큰`: `laam-pos-plugin-api-token`과 같은 값
   - `테이블 매핑 JSON`: QR 테이블명과 POS 내부 숫자 테이블 ID가 자동으로 맞지 않을 때만 입력

테이블명은 공백, `-`, `_`를 제거해 자동 비교합니다. 예를 들어 QR의 `T-01`은 POS의 `T01`과 자동으로 연결됩니다. POS 테이블명이 다른 경우 다음처럼 명시합니다.

```json
{"T-01": 12345, "T-02": 12346}
```

숫자 ID는 `posPluginSdk.table.getTables()`가 반환하는 POS 내부 테이블 ID입니다. 개발 중에는 플러그인 로그에서 테이블 목록을 확인하거나 임시 진단 코드를 사용해 값을 확인합니다.

## 전환 시 주의사항

- 토스 POS 플러그인 설치와 설정이 끝나기 전에는 `POS_ORDER_PROVIDER=open-api`를 유지합니다.
- `plugin` 모드에서는 Open API 주문 생성이 중지됩니다. 두 방식을 동시에 켜지 않으므로 같은 손님 주문이 두 번 등록되지 않습니다.
- 테이블 API는 토스플레이스의 음식점 후불 매장에서만 사용할 수 있습니다.
- 개발 버전 테스트 후 실제 매장 배포에는 토스플레이스 검수와 배포 절차가 필요합니다.

공식 문서: [플러그인 패키지](https://docs.tossplace.com/guide/pos-integration/plugin/develop/package.html), [Table API](https://docs.tossplace.com/reference/plugin-sdk/pos/table.html), [Order API](https://docs.tossplace.com/reference/plugin-sdk/pos/order.html), [플러그인 배포](https://docs.tossplace.com/guide/pos-integration/plugin/deploy.html)
