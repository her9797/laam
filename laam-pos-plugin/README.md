# laam-pos-plugin

`laam-pos-plugin`은 손님 웹 주문을 토스 POS의 실제 테이블 주문에 연결하는 백그라운드 Worker 플러그인입니다. `laam-api`에서 대기 주문을 한 건씩 가져오고, POS 내부 테이블과 카탈로그를 조회해 다음처럼 처리합니다.

- 대상 테이블에 진행 중 주문이 없으면 `posPluginSdk.order.add`로 테이블 주문 생성
- 진행 중 주문이 있으면 `posPluginSdk.order.addMenu`로 새 메뉴만 추가
- POS 등록 직후 처리 결과를 보안 저장소에 기록해 API 응답 유실·POS 재시작 시 중복 등록 방지
- 실패한 주문은 API에 오류를 남기고 2분 뒤 다시 시도

관리자가 요청한 테이블 동기화도 같은 폴링 루프에서 처리합니다. 대기 중인 요청이 있으면 POS의 공간(`table.getHalls`)과 테이블(`table.getTables`) 목록만 `laam-api`에 올리고, 관리자 웹에서 QR 테이블과 POS 테이블을 연결합니다. 주문 정보는 올리지 않습니다. 동기화가 실패해도 사유만 API에 남기고 주문 처리는 계속합니다.

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
   - `예비 테이블 매핑 JSON`: 평소에는 비워 둡니다. 아래 "예비 매핑" 참고

## 테이블 연결

테이블 연결은 관리자 웹에서 합니다. 플러그인 설정에 숫자 ID를 직접 입력할 필요가 없습니다.

1. 관리자 웹의 테이블 화면에서 POS 테이블 동기화를 요청합니다.
2. 플러그인이 다음 폴링(최대 3초)에서 요청을 가져가 POS의 공간·테이블 목록을 올립니다. 응답이 30초 안에 오지 않으면 관리자 화면에 시간 초과로 표시되므로 POS 기기가 켜져 있고 플러그인이 실행 중인지 확인합니다.
3. 이름이 명확한 테이블은 자동으로 연결됩니다. 공백, `-`, `_`를 제거해 비교하므로 QR의 `T-01`은 POS의 `T01`, `테이블 1`과 연결되고 `B-03`은 `바3`, `바자리3`과 연결됩니다. 후보가 둘 이상이거나 룸·테라스처럼 규칙에 맞지 않는 이름은 자동 연결하지 않습니다.
4. 남은 테이블은 관리자 화면에서 직접 연결합니다.

주문 실행 시 플러그인은 서버에 저장된 연결을 먼저 사용합니다. 연결 정보는 약 30초 동안 캐시하므로 관리자 화면에서 바꾼 연결은 최대 30초 뒤부터 적용됩니다.

### 예비 매핑

`예비 테이블 매핑 JSON`은 서버 연결을 쓸 수 없을 때만 사용하는 예비 수단입니다. `laam-api` 호출이 실패하면 플러그인은 조용히 이 값으로 내려갑니다.

```json
{"T-01": 12345, "T-02": 12346}
```

숫자 ID는 `posPluginSdk.table.getTables()`가 반환하는 POS 내부 테이블 ID이며, 관리자 웹의 테이블 화면에서도 확인할 수 있습니다. 서버 연결이 정상일 때는 서버 값이 이 JSON보다 우선합니다.

## 전환 시 주의사항

- 토스 POS 플러그인 설치와 설정이 끝나기 전에는 `POS_ORDER_PROVIDER=open-api`를 유지합니다.
- `plugin` 모드에서는 Open API 주문 생성이 중지됩니다. 두 방식을 동시에 켜지 않으므로 같은 손님 주문이 두 번 등록되지 않습니다.
- 테이블 API는 토스플레이스의 음식점 후불 매장에서만 사용할 수 있습니다.
- 테이블 연결이 하나라도 있으면 연결되지 않은 QR 테이블의 주문은 서버에서 거절됩니다. 연결이 하나도 없는 동안에는 이 검사를 건너뛰므로 기존 매장 동작이 그대로 유지됩니다.
- 개발 버전 테스트 후 실제 매장 배포에는 토스플레이스 검수와 배포 절차가 필요합니다.

공식 문서: [플러그인 패키지](https://docs.tossplace.com/guide/pos-integration/plugin/develop/package.html), [Table API](https://docs.tossplace.com/reference/plugin-sdk/pos/table.html), [Order API](https://docs.tossplace.com/reference/plugin-sdk/pos/order.html), [플러그인 배포](https://docs.tossplace.com/guide/pos-integration/plugin/deploy.html)
