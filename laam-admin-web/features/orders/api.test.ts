import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/lib/api/fetch-json";

import { acknowledgeOrder, fetchOrder, fetchOrdersPage } from "./api";
import type { OrderListQuery } from "./model";

vi.mock("@/lib/api/fetch-json", () => ({ fetchJson: vi.fn() }));

const BASE_QUERY: OrderListQuery = {
  page: 1,
  pageSize: 10,
  status: "DONE",
  posSyncStatus: undefined,
  search: "",
  dateFrom: "",
  dateTo: "",
  sort: "createdAt",
  order: "desc",
};

describe("fetchOrdersPage", () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset().mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
  });

  it("always sends page/pageSize/sort/order, and status when set", async () => {
    await fetchOrdersPage(BASE_QUERY);

    const [path] = vi.mocked(fetchJson).mock.calls[0];
    const url = new URL(String(path), "http://localhost");
    expect(url.pathname).toBe("/api/admin/payment-orders");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pageSize")).toBe("10");
    expect(url.searchParams.get("sort")).toBe("createdAt");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("status")).toBe("DONE");
  });

  it("omits status when there is no status filter", async () => {
    await fetchOrdersPage({ ...BASE_QUERY, status: undefined });

    const [path] = vi.mocked(fetchJson).mock.calls[0];
    const url = new URL(String(path), "http://localhost");
    expect(url.searchParams.has("status")).toBe(false);
  });

  it("sends posSync only when set", async () => {
    await fetchOrdersPage({ ...BASE_QUERY, posSyncStatus: "FAILED" });

    const [path] = vi.mocked(fetchJson).mock.calls[0];
    const url = new URL(String(path), "http://localhost");
    expect(url.searchParams.get("posSync")).toBe("FAILED");
  });

  it("omits q when search is blank, sends it trimmed otherwise", async () => {
    await fetchOrdersPage({ ...BASE_QUERY, search: "  T-01  " });

    const [path] = vi.mocked(fetchJson).mock.calls[0];
    const url = new URL(String(path), "http://localhost");
    expect(url.searchParams.get("q")).toBe("T-01");
  });

  it("resolves a dateFrom/dateTo pair to concrete from/to bounds", async () => {
    await fetchOrdersPage({ ...BASE_QUERY, dateFrom: "2026-01-01", dateTo: "2026-01-08" });

    const [path] = vi.mocked(fetchJson).mock.calls[0];
    const url = new URL(String(path), "http://localhost");
    expect(url.searchParams.get("from")).toBeTruthy();
    expect(url.searchParams.get("to")).toBeTruthy();
  });

  it("sends no from/to when dateFrom/dateTo are blank", async () => {
    await fetchOrdersPage(BASE_QUERY);

    const [path] = vi.mocked(fetchJson).mock.calls[0];
    const url = new URL(String(path), "http://localhost");
    expect(url.searchParams.has("from")).toBe(false);
    expect(url.searchParams.has("to")).toBe(false);
  });
});

describe("fetchOrder", () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset().mockResolvedValue({ orderId: "order-1" });
  });

  it("requests the single-order path with the id URL-encoded", async () => {
    await fetchOrder("order 1/weird");

    const [path] = vi.mocked(fetchJson).mock.calls[0];
    expect(path).toBe("/api/admin/payment-orders/order%201%2Fweird");
  });
});

describe("acknowledgeOrder", () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset().mockResolvedValue({ orderId: "order-1", status: "ACKNOWLEDGED" });
  });

  it("PATCHes the order's status path with status ACKNOWLEDGED", async () => {
    await acknowledgeOrder("order 1/weird");

    const [path, init] = vi.mocked(fetchJson).mock.calls[0];
    expect(path).toBe("/api/admin/payment-orders/order%201%2Fweird/status");
    expect(init).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACKNOWLEDGED" }),
    });
  });
});
