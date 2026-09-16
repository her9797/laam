import { createHash, timingSafeEqual } from "node:crypto";

function digestToken(value: string) {
  return createHash("sha256").update(value).digest();
}

export function isCustomerTestEntryTokenValid(expectedToken: string, receivedToken: string | null) {
  if (!expectedToken || !receivedToken) {
    return false;
  }

  return timingSafeEqual(digestToken(expectedToken), digestToken(receivedToken));
}

export function normalizeCustomerTestTable(value: string | null) {
  const match = value?.trim().toUpperCase().match(/^([TB])-(\d{1,2})$/);
  if (!match) {
    return "";
  }

  const [, area, numberRaw] = match;
  const number = Number(numberRaw);
  const maxTableNumber = area === "T" ? 12 : 5;
  if (!Number.isInteger(number) || number < 1 || number > maxTableNumber) {
    return "";
  }

  return `${area}-${String(number).padStart(2, "0")}`;
}
