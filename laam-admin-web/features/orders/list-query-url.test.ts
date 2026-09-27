import { describe, expect, it } from "vitest";

import {
  buildOrderListSearchParams,
  buildOrderListUrlSearchParams,
  parseOrderListQuery,
  parseOrderListUrlState,
  toBillListQuery,
  type OrderListUrlState,
} from "./list-query-url";
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

describe("order list view (menu / bill) URL state", () => {
  it("defaults to the menu view with no bill filters", () => {
    const params = new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-08");
    const state = parseOrderListUrlState(params);
    expect(state.view).toBe("menu");
    expect(state.billStatus).toBeUndefined();
    expect(state.billSource).toBeUndefined();
    expect(state.query).toEqual(parseOrderListQuery(params));
  });

  it("omits the view param in the menu view so existing links are unchanged", () => {
    const params = new URLSearchParams(
      "page=2&status=READY&posSync=FAILED&q=T-01&dateFrom=2026-01-01&dateTo=2026-01-08&sort=amount&order=asc",
    );
    const rebuilt = buildOrderListUrlSearchParams(parseOrderListUrlState(params));
    expect(rebuilt.has("view")).toBe(false);
    expect(rebuilt.toString()).toBe(buildOrderListSearchParams(parseOrderListQuery(params)).toString());
  });

  it("does not write bill-only filters in the menu view", () => {
    const rebuilt = buildOrderListUrlSearchParams(
      parseOrderListUrlState(new URLSearchParams("billStatus=PAID&source=CARD")),
    );
    expect(rebuilt.has("billStatus")).toBe(false);
    expect(rebuilt.has("source")).toBe(false);
  });

  it("round-trips the bill view with its own filters and the shared ones", () => {
    const state: OrderListUrlState = {
      view: "bill",
      query: {
        page: 3,
        pageSize: 30,
        status: undefined,
        posSyncStatus: undefined,
        search: "T-01",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-08",
        sort: "createdAt",
        order: "desc",
      },
      billStatus: "PAID",
      billSource: "ACCOUNT_TRANSFER",
    };
    const params = buildOrderListUrlSearchParams(state);
    expect(params.get("view")).toBe("bill");
    expect(params.get("billStatus")).toBe("PAID");
    expect(params.get("source")).toBe("ACCOUNT_TRANSFER");
    expect(parseOrderListUrlState(params)).toEqual(state);
  });

  it("drops menu-only params (status, posSync, sort, order) from the bill view URL", () => {
    const params = buildOrderListUrlSearchParams(
      parseOrderListUrlState(
        new URLSearchParams(
          "view=bill&status=READY&posSync=FAILED&sort=amount&order=asc&dateFrom=2026-01-01&dateTo=2026-01-08",
        ),
      ),
    );
    expect(params.has("status")).toBe(false);
    expect(params.has("posSync")).toBe(false);
    expect(params.has("sort")).toBe(false);
    expect(params.has("order")).toBe(false);
    expect(params.get("dateFrom")).toBe("2026-01-01");
    expect(params.get("dateTo")).toBe("2026-01-08");
  });

  it("falls back to defaults for unrecognized view and bill filter values", () => {
    const state = parseOrderListUrlState(new URLSearchParams("view=table&billStatus=DONE&source=POS"));
    expect(state.view).toBe("menu");
    expect(state.billStatus).toBeUndefined();
    expect(state.billSource).toBeUndefined();

    const billState = parseOrderListUrlState(new URLSearchParams("view=bill&billStatus=paid&source=card"));
    expect(billState.view).toBe("bill");
    expect(billState.billStatus).toBeUndefined();
    expect(billState.billSource).toBeUndefined();
  });

  it("accepts every TossPlace source type as a bill payment filter", () => {
    for (const source of ["CARD", "CASH", "ACCOUNT_TRANSFER", "BARCODE", "PREPAID_VALUE", "EXTERNAL"]) {
      expect(parseOrderListUrlState(new URLSearchParams(`view=bill&source=${source}`)).billSource).toBe(source);
    }
  });

  it("maps the URL state into a BillListQuery", () => {
    const state = parseOrderListUrlState(
      new URLSearchParams(
        "view=bill&page=2&pageSize=30&q=7&dateFrom=2026-01-01&dateTo=2026-01-08&billStatus=OPEN&source=CASH",
      ),
    );
    expect(toBillListQuery(state)).toEqual({
      page: 2,
      pageSize: 30,
      status: "OPEN",
      sourceType: "CASH",
      search: "7",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-08",
    });
  });
});
