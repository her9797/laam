import { describe, expect, it } from "vitest";

import i18n from "@/i18n/client";

import { paymentMethodLabel } from "./payment-method";

const t = i18n.getFixedT("ko", "orders");

describe("paymentMethodLabel", () => {
  it.each([
    ["CARD", "카드"],
    ["CASH", "현금"],
    ["ACCOUNT_TRANSFER", "계좌이체"],
    ["BARCODE", "간편결제"],
    ["PREPAID_VALUE", "선불결제"],
    ["EXTERNAL", "외부결제"],
    ["POS", "POS(미확인)"],
    ["UNDEFINED", "미확인"],
    ["", "미확인"],
  ])("labels %j as %j", (method, label) => {
    expect(paymentMethodLabel(method, t)).toBe(label);
  });

  it("labels a missing method as unconfirmed", () => {
    expect(paymentMethodLabel(undefined, t)).toBe("미확인");
  });

  it.each(["카드", "간편결제", "SOMETHING_NEW"])("passes an unknown value %j through unchanged", (method) => {
    expect(paymentMethodLabel(method, t)).toBe(method);
  });

  it("uses the English copy when the English translator is passed", () => {
    const en = i18n.getFixedT("en", "orders");
    expect(paymentMethodLabel("CARD", en)).toBe("Card");
    expect(paymentMethodLabel("UNDEFINED", en)).toBe("Unconfirmed");
  });
});
