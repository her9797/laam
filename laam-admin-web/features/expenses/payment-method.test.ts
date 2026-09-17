import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LAST_PAYMENT_METHOD_KEY,
  readLastPaymentMethod,
  rememberPaymentMethod,
} from "./payment-method";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("payment method default", () => {
  it("defaults to card when nothing was saved", () => {
    expect(readLastPaymentMethod()).toBe("card");
  });

  it("returns the last saved method", () => {
    rememberPaymentMethod("transfer");
    expect(window.localStorage.getItem(LAST_PAYMENT_METHOD_KEY)).toBe("transfer");
    expect(readLastPaymentMethod()).toBe("transfer");
  });

  it("ignores an unknown stored value", () => {
    window.localStorage.setItem(LAST_PAYMENT_METHOD_KEY, "bitcoin");
    expect(readLastPaymentMethod()).toBe("card");
  });

  it("falls back to card and does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLastPaymentMethod()).toBe("card");
    expect(() => rememberPaymentMethod("cash")).not.toThrow();
  });
});
