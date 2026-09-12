import { describe, expect, it } from "vitest";

import { buildOrderListSearchParams, parseOrderListQuery } from "./list-query-url";
import type { OrderListQuery } from "./model";

describe("parseOrderListQuery", () => {
  it("defaults to page 1, pageSize 10, no status filter, no posSync filter, no search, no date bound, sort createdAt desc", () => {
    const query = parseOrderListQuery(new URLSearchParams());
    expect(query).toEqual({
      page: 1,
      pageSize: 10,
      status: undefined,
      posSyncStatus: undefined,
      search: "",
      dateFrom: "",
      dateTo: "",
      sort: "createdAt",
      order: "desc",
    });
  });

  it("reads every recognized param from the URL", () => {
    const query = parseOrderListQuery(
      new URLSearchParams(
        "page=2&pageSize=30&status=READY&posSync=FAILED&q=T-01&dateFrom=2026-01-01&dateTo=2026-01-08&sort=amount&order=asc",
      ),
    );
    expect(query).toEqual({
      page: 2,
      pageSize: 30,
      status: "READY",
      posSyncStatus: "FAILED",
      search: "T-01",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-08",
      sort: "amount",
      order: "asc",
    });
  });

  it("treats status=all as no status filter", () => {
    const query = parseOrderListQuery(new URLSearchParams("status=all"));
    expect(query.status).toBeUndefined();
  });

  it("accepts status=CANCELLED as a valid status filter", () => {
    const query = parseOrderListQuery(new URLSearchParams("status=CANCELLED"));
    expect(query.status).toBe("CANCELLED");
  });

  it("accepts status=ACKNOWLEDGED as a valid status filter", () => {
    const query = parseOrderListQuery(new URLSearchParams("status=ACKNOWLEDGED"));
    expect(query.status).toBe("ACKNOWLEDGED");
  });

  it("falls back to defaults for unrecognized enum values", () => {
    const query = parseOrderListQuery(
      new URLSearchParams("status=CANCELED&posSync=UNKNOWN&dateFrom=not-a-date&sort=tableNumber&order=random"),
    );
    expect(query.status).toBeUndefined();
    expect(query.posSyncStatus).toBeUndefined();
    expect(query.dateFrom).toBe("");
    expect(query.sort).toBe("createdAt");
    expect(query.order).toBe("desc");
  });

  it("falls back to page 1 / pageSize 10 for invalid paging params", () => {
    const query = parseOrderListQuery(new URLSearchParams("page=0&pageSize=999"));
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(10);
  });
});

describe("buildOrderListSearchParams", () => {
  const DEFAULT_QUERY: OrderListQuery = {
    page: 1,
    pageSize: 10,
    status: undefined,
    posSyncStatus: undefined,
    search: "",
    dateFrom: "",
    dateTo: "",
    sort: "createdAt",
    order: "desc",
  };

  it("serializes to an empty string for the default query", () => {
    expect(buildOrderListSearchParams(DEFAULT_QUERY).toString()).toBe("");
  });

  it("round-trips a non-default query through the URL", () => {
    const query: OrderListQuery = {
      page: 2,
      pageSize: 30,
      status: "CANCELLED",
      posSyncStatus: "FAILED",
      search: "T-01",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-08",
      sort: "amount",
      order: "asc",
    };
    const params = buildOrderListSearchParams(query);
    expect(parseOrderListQuery(params)).toEqual(query);
  });

  it("omits the status param entirely for the default 'no status filter' query", () => {
    const params = buildOrderListSearchParams(DEFAULT_QUERY);
    expect(params.has("status")).toBe(false);
  });

  it("serializes dateFrom/dateTo whenever set, since there is no fixed default", () => {
    const params = buildOrderListSearchParams({ ...DEFAULT_QUERY, dateFrom: "2026-01-01", dateTo: "2026-01-08" });
    expect(params.get("dateFrom")).toBe("2026-01-01");
    expect(params.get("dateTo")).toBe("2026-01-08");
  });
});
