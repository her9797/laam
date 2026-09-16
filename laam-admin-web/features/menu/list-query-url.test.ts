import { describe, expect, it } from "vitest";

import { buildMenuListSearchParams, parseMenuListQuery } from "./list-query-url";
import type { MenuListQuery } from "./list-query-url";

describe("parseMenuListQuery", () => {
  it("defaults to page 1, pageSize 10, no category, empty search, no sort, order asc", () => {
    const query = parseMenuListQuery(new URLSearchParams());
    expect(query).toEqual({
      page: 1,
      pageSize: 10,
      category: "",
      search: "",
      sort: "",
      order: "asc",
    });
  });

  it("reads every recognized param from the URL", () => {
    const query = parseMenuListQuery(
      new URLSearchParams("page=2&pageSize=30&category=drinks&q=latte&sort=price&order=desc"),
    );
    expect(query).toEqual({
      page: 2,
      pageSize: 30,
      category: "drinks",
      search: "latte",
      sort: "price",
      order: "desc",
    });
  });

  it("falls back to defaults for unrecognized enum values", () => {
    const query = parseMenuListQuery(new URLSearchParams("sort=unknown&order=random"));
    expect(query.sort).toBe("");
    expect(query.order).toBe("asc");
  });

  it("falls back to page 1 / pageSize 10 for invalid paging params", () => {
    const query = parseMenuListQuery(new URLSearchParams("page=0&pageSize=999"));
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(10);
  });
});

describe("buildMenuListSearchParams", () => {
  const DEFAULT_QUERY: MenuListQuery = {
    page: 1,
    pageSize: 10,
    category: "",
    search: "",
    sort: "",
    order: "asc",
  };

  it("serializes to an empty string for the default query", () => {
    expect(buildMenuListSearchParams(DEFAULT_QUERY).toString()).toBe("");
  });

  it("round-trips a non-default query through the URL", () => {
    const query: MenuListQuery = {
      page: 2,
      pageSize: 30,
      category: "drinks",
      search: "latte",
      sort: "price",
      order: "desc",
    };
    const params = buildMenuListSearchParams(query);
    expect(parseMenuListQuery(params)).toEqual(query);
  });

  it("omits the category param for the default 'every category' query", () => {
    const params = buildMenuListSearchParams(DEFAULT_QUERY);
    expect(params.has("category")).toBe(false);
  });
});
