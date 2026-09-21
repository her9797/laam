import { normalizeQrTable } from "./qr-table.ts";

/**
 * 화면에 보여 줄 테이블 이름.
 *
 * 테이블은 POS에서 오고 코드는 관리자가 정하므로 구역 문자를 T/B로 가정하면
 * 안 된다. `lib/qr-table.ts`의 규칙을 그대로 써서 어떤 구역 문자든 코드를
 * 그대로 보여 준다. 숫자만 저장된 옛 값은 일반 테이블(T)로 읽는다.
 */
export function formatTableLabel(tableNumber: string) {
  if (!tableNumber) {
    return "TABLE";
  }

  const normalized = normalizeQrTable(tableNumber);
  if (normalized) {
    return normalized;
  }

  const digitsOnly = tableNumber.trim();
  if (/^\d{1,2}$/.test(digitsOnly)) {
    return `T-${digitsOnly.padStart(2, "0")}`;
  }

  return tableNumber.trim().toUpperCase();
}
