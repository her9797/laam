import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/lib/api/fetch-json";

import { fetchBill, fetchBillsPage } from "./api";
import type { BillListQuery } from "./model";

vi.mock("@/lib/api/fetch-json", () => ({ fetchJson: vi.fn() }));

const BASE_QUERY: BillListQuery = {
  page: 2,
  pageSize: 20,
  search: "",
  dateFrom: "",
  dateTo: "",
};

function requestedURL(): URL {
  const [path] = vi.mocked(fetchJson).mock.calls[0];
  return new URL(String(path), "http://localhost");
}

describe("fetchBillsPage", () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it("always sends page/pageSize and omits unset filters", async () => {
    await fetchBillsPage(BASE_QUERY);

    const url = requestedURL();
    expect(url.pathname).toBe("/api/admin/payment-bills");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("pageSize")).toBe("20");
    for (const key of ["status", "sourceType", "q", "from", "to"]) {
      expect(url.searchParams.has(key)).toBe(false);
    }
  });

  it("sends status, sourceType and trimmed search when set", async () => {
    await fetchBillsPage({ ...BASE_QUERY, status: "PAID", sourceType: "ACCOUNT_TRANSFER", search: "  T-03 " });

    const url = requestedURL();
    expect(url.searchParams.get("status")).toBe("PAID");
    expect(url.searchParams.get("sourceType")).toBe("ACCOUNT_TRANSFER");
    expect(url.searchParams.get("q")).toBe("T-03");
  });

  it("resolves a valid date pair to from/to bounds", async () => {
    await fetchBillsPage({ ...BASE_QUERY, dateFrom: "2026-09-01", dateTo: "2026-09-02" });

    const url = requestedURL();
    expect(url.searchParams.get("from")).not.toBeNull();
    expect(url.searchParams.get("to")).not.toBeNull();
    expect(Date.parse(url.searchParams.get("from")!)).toBeLessThan(Date.parse(url.searchParams.get("to")!));
  });
});

describe("fetchBill", () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset().mockResolvedValue({});
  });

  it("GETs the encoded bill id", async () => {
    await fetchBill("bill/1");

    const [path, init] = vi.mocked(fetchJson).mock.calls[0];
    expect(path).toBe("/api/admin/payment-bills/bill%2F1");
    expect(init).toEqual({ method: "GET" });
  });
});
