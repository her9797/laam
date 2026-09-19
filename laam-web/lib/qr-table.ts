/**
 * QR 테이블 이름(`T-01`, `B-03`) 정규화.
 *
 * 관리자 화면에서 POS 테이블을 그대로 QR 테이블로 추가할 수 있게 되면서
 * 테이블 개수가 고정이 아니게 됐다. 그래서 여기서는 번호 상한을 두지 않고
 * 형식(구역 문자 + 두 자리 번호)만 확인한다. 실제 입장 허용 여부는
 * `lib/auth.ts`의 서명 검사가 가른다.
 */
const QR_TABLE_PATTERN = /^([A-Z])-(\d{1,2})$/;

export function normalizeQrTable(value: string | null) {
  const match = value?.trim().toUpperCase().match(QR_TABLE_PATTERN);
  if (!match) {
    return "";
  }

  const [, area, numberRaw] = match;
  const number = Number(numberRaw);
  if (!Number.isInteger(number) || number < 1) {
    return "";
  }

  return `${area}-${String(number).padStart(2, "0")}`;
}
