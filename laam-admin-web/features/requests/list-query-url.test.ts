import { describe, expect, it } from "vitest";

import { buildRequestListSearchParams, parseRequestListQuery } from "./list-query-url";

describe("parseRequestListQuery", () => {
  it("defaults to page 1, page size 10, no status filter, empty search, status-sort ascending", () => {
    const query = parseRequestListQuery(new URLSearchParams(), "general");

    expect(query).toEqual({
      page: 1,
      pageSize: 10,
      status: undefined,
      kind: "general",
      search: "",
      dateFrom: "",
      dateTo: "",
      sort: "status",
      order: "asc",
    });
  });

  it("reads page/pageSize/status/q/dateFrom/dateTo/sort/order from the given search params", () => {
    const query = parseRequestListQuery(
      new URLSearchParams(
        "page=3&pageSize=30&status=checked&q=napkin&dateFrom=2026-01-01&dateTo=2026-01-08&sort=createdAt&order=asc",
      ),
      "song",
    );

    expect(query).toEqual({
      page: 3,
      pageSize: 30,
      status: "checked",
      kind: "song",
      search: "napkin",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-08",
      sort: "createdAt",
      order: "asc",
    });
  });

  it("falls back to the default page size for an unrecognized pageSize value", () => {
    expect(parseRequestListQuery(new URLSearchParams("pageSize=15"), "general").pageSize).toBe(10);
    expect(parseRequestListQuery(new URLSearchParams("pageSize=abc"), "general").pageSize).toBe(10);
  });

  it("falls back to page 1 for a non-numeric or non-positive page", () => {
    expect(parseRequestListQuery(new URLSearchParams("page=abc"), "general").page).toBe(1);
    expect(parseRequestListQuery(new URLSearchParams("page=0"), "general").page).toBe(1);
    expect(parseRequestListQuery(new URLSearchParams("page=-3"), "general").page).toBe(1);
  });

  it("ignores an unrecognized status instead of passing it through", () => {
    const query = parseRequestListQuery(new URLSearchParams("status=archived"), "general");
    expect(query.status).toBeUndefined();
  });

  it("ignores an unrecognized sort and falls back to the status default", () => {
    const query = parseRequestListQuery(new URLSearchParams("sort=id"), "general");
    expect(query.sort).toBe("status");
    expect(query.order).toBe("asc");
  });

  it("defaults order to desc when sort is createdAt or tableNumber without an explicit order", () => {
    expect(parseRequestListQuery(new URLSearchParams("sort=createdAt"), "general").order).toBe("desc");
    expect(parseRequestListQuery(new URLSearchParams("sort=tableNumber"), "general").order).toBe("desc");
  });
});

describe("buildRequestListSearchParams", () => {
  it("round-trips through parseRequestListQuery", () => {
    const original = parseRequestListQuery(
      new URLSearchParams("page=2&status=pending&q=hello&sort=tableNumber&order=asc"),
      "general",
    );

    const rebuilt = parseRequestListQuery(buildRequestListSearchParams(original), "general");

    expect(rebuilt).toEqual(original);
  });

  it("omits page and pageSize when they are the defaults, so the URL stays clean on the first page", () => {
    const params = buildRequestListSearchParams({
      page: 1,
      pageSize: 10,
      status: undefined,
      kind: "general",
      search: "",
      dateFrom: "",
      dateTo: "",
      sort: "status",
      order: "asc",
    });

    expect(params.has("page")).toBe(false);
    expect(params.has("pageSize")).toBe(false);
    expect(params.has("status")).toBe(false);
    expect(params.has("q")).toBe(false);
    expect(params.has("dateFrom")).toBe(false);
    expect(params.has("dateTo")).toBe(false);
  });

  it("includes pageSize when it departs from the default", () => {
    const params = buildRequestListSearchParams({
      page: 1,
      pageSize: 30,
      status: undefined,
      kind: "general",
      search: "",
      dateFrom: "",
      dateTo: "",
      sort: "status",
      order: "asc",
    });

    expect(params.get("pageSize")).toBe("30");
  });

  it("serializes dateFrom/dateTo whenever set, since there is no fixed default", () => {
    const params = buildRequestListSearchParams({
      page: 1,
      pageSize: 10,
      status: undefined,
      kind: "general",
      search: "",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-08",
      sort: "status",
      order: "asc",
    });

    expect(params.get("dateFrom")).toBe("2026-01-01");
    expect(params.get("dateTo")).toBe("2026-01-08");
  });
});
