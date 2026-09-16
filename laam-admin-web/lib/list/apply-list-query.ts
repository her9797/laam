/**
 * Search/sort/pagination for lists whose data is already fully loaded in
 * memory — the product (menu/category) and notice screens, whose source is
 * `GET /api/bootstrap`. That endpoint is a **public** contract shared with
 * `laam-web`, so it is not a server-pagination target (see
 * `docs/plans/2026-09-04-admin-list-paging-search-sort.md` section 3.1);
 * this module gives those screens the same toolbar/pagination UX as the
 * server-backed request lists, applied client-side instead.
 */
export type ListQueryState = {
  search: string;
  /** Empty string means "keep the input array's order". */
  sort: string;
  order: "asc" | "desc";
  page: number;
  pageSize: number;
};

export type ApplyListQueryOptions<T> = {
  searchText: (item: T) => string;
  /** Required only when `query.sort` is non-empty. */
  sortValue?: (item: T, sortKey: string) => string | number;
};

export type ListQueryResult<T> = {
  items: T[];
  total: number;
};

function compareValues(a: string | number, b: string | number): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

export function applyListQuery<T>(
  items: T[],
  query: ListQueryState,
  options: ApplyListQueryOptions<T>,
): ListQueryResult<T> {
  const search = query.search.trim().toLowerCase();
  const filtered = search
    ? items.filter((item) => options.searchText(item).toLowerCase().includes(search))
    : items;

  let sorted = filtered;
  if (query.sort && options.sortValue) {
    const sortValue = options.sortValue;
    const direction = query.order === "asc" ? 1 : -1;
    sorted = [...filtered].sort(
      (a, b) => compareValues(sortValue(a, query.sort), sortValue(b, query.sort)) * direction,
    );
  }

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(Math.max(1, query.page), pageCount);
  const start = (page - 1) * query.pageSize;

  return { items: sorted.slice(start, start + query.pageSize), total };
}
