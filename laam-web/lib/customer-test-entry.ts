import { createHash, timingSafeEqual } from "node:crypto";

import { normalizeQrTable } from "./qr-table.ts";

function digestToken(value: string) {
  return createHash("sha256").update(value).digest();
}

export function isCustomerTestEntryTokenValid(expectedToken: string, receivedToken: string | null) {
  if (!expectedToken || !receivedToken) {
    return false;
  }

  return timingSafeEqual(digestToken(expectedToken), digestToken(receivedToken));
}

/**
 * 테스트 입장(`/test/enter`)의 테이블 정규화. QR 입장과 같은 규칙을 써야
 * 한다. 테이블은 POS에서 오고 코드는 관리자가 정하므로, 번호 상한이나
 * T/B 제한을 여기서만 들고 있으면 QR로는 되는 자리가 테스트 입장에서만
 * 막힌다.
 */
export function normalizeCustomerTestTable(value: string | null) {
  return normalizeQrTable(value);
}
