import { describe, expect, it } from "vitest";

import { applyListQuery, type ListQueryState } from "./apply-list-query";

type Item = { id: string; name: string; price: number };

const items: Item[] = [
  { id: "1", name: "Americano", price: 4000 },
  { id: "2", name: "Latte", price: 4500 },
  { id: "3", name: "Espresso", price: 3500 },
  { id: "4", name: "Cappuccino", price: 4500 },
];

function baseQuery(overrides: Partial<ListQueryState> = {}): ListQueryState {
  return { search: "", sort: "", order: "asc", page: 1, pageSize: 20, ...overrides };
}

describe("applyListQuery", () => {
  it("returns every item unfiltered, unsorted, on one page when the query is empty", () => {
    const result = applyListQuery(items, baseQuery(), { searchText: (item) => item.name });

    expect(result.total).toBe(4);
    expect(result.items.map((item) => item.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("filters by case-insensitive substring match on searchText", () => {
    const result = applyListQuery(items, baseQuery({ search: "cap" }), {
      searchText: (item) => item.name,
    });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["4"]);
  });

  it("sorts ascending and descending by the given sort key", () => {
    const sortValue = (item: Item, key: string) => (key === "price" ? item.price : item.name);

    const asc = applyListQuery(items, baseQuery({ sort: "price", order: "asc" }), {
      searchText: (item) => item.name,
      sortValue,
    });
    expect(asc.items.map((item) => item.id)).toEqual(["3", "1", "2", "4"]);

    const desc = applyListQuery(items, baseQuery({ sort: "price", order: "desc" }), {
      searchText: (item) => item.name,
      sortValue,
    });
    expect(desc.items.map((item) => item.id)).toEqual(["2", "4", "1", "3"]);
  });

  it("paginates the (filtered, sorted) result and reports the pre-pagination total", () => {
    const result = applyListQuery(items, baseQuery({ page: 2, pageSize: 2 }), {
      searchText: (item) => item.name,
    });

    expect(result.total).toBe(4);
    expect(result.items.map((item) => item.id)).toEqual(["3", "4"]);
  });

  it("clamps a page number beyond the last page down to the last page", () => {
    const result = applyListQuery(items, baseQuery({ page: 99, pageSize: 2 }), {
      searchText: (item) => item.name,
    });

    expect(result.items.map((item) => item.id)).toEqual(["3", "4"]);
  });

  it("returns an empty page (not an error) when the filter matches nothing", () => {
    const result = applyListQuery(items, baseQuery({ search: "no-such-item" }), {
      searchText: (item) => item.name,
    });

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});
