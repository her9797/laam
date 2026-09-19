/**
 * 주문 API 오류 응답을 손님에게 보여 줄 문구로 바꾼다.
 *
 * `laam-api`는 QR 테이블이 POS 테이블에 연결되지 않았을 때 주문 생성을
 * 400 + `code: "table_not_linked"`로 막는다. 이때만은 서버가 준 영어 문구
 * 대신 손님이 무엇을 해야 하는지 알 수 있는 안내를 보여 준다. 그 밖의
 * 오류는 지금까지처럼 서버 문구를 그대로 전한다.
 */
export const TABLE_NOT_LINKED_CODE = "table_not_linked";

export const TABLE_NOT_LINKED_MESSAGE = "이 자리는 아직 준비 중이에요. 직원을 불러 주세요.";

export type OrderErrorBody = { error?: string; code?: string } | null;

export function orderErrorMessage(body: OrderErrorBody, fallback: string) {
  if (body?.code === TABLE_NOT_LINKED_CODE) {
    return TABLE_NOT_LINKED_MESSAGE;
  }
  return body?.error || fallback;
}
