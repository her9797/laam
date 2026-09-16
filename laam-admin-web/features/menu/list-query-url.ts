import { PAGE_SIZE_OPTIONS } from "@/components/list/Pagination";

/**
 * URL <-> query codec for the `/menu` screen's search/category/sort/page
 * state. This list is entirely client-side (filtered/sorted/paginated over
 * the already-loaded bootstrap tree via `@/lib/list/apply-list-query`, not
 * a server fetch), but the state itself is still synced to the URL — same
 * reasoning as `features/orders/list-query-url.ts`: the screen carries no
 * personal data, so a bookmarked/shared filtered view is safe and useful.
 */
export type MenuListQuery = {
  page: number;
  pageSize: number;
  category: string; // "" = every category
  search: string;
  sort: string; // "" = input order | "name" | "price"
  order: "asc" | "desc";
};

const DEFAULT_PAGE_SIZE = 10;
const VALID_SORTS = ["name", "price"];

function parsePageSize(value: string | null): number {
  const parsed = Number(value);
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])
    ? parsed
    : DEFAULT_PAGE_SIZE;
}

export function parseMenuListQuery(searchParams: URLSearchParams): MenuListQuery {
  const pageRaw = Number(searchParams.get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const sortRaw = searchParams.get("sort");
  const sort = sortRaw && VALID_SORTS.includes(sortRaw) ? sortRaw : "";

  const orderRaw = searchParams.get("order");
  const order = orderRaw === "desc" ? "desc" : "asc";

  return {
    page,
    pageSize: parsePageSize(searchParams.get("pageSize")),
    category: searchParams.get("category") ?? "",
    search: searchParams.get("q") ?? "",
    sort,
    order,
  };
}

/**
 * Serializes only what departs from the default, so the URL for the
 * default view of the list stays a bare pathname.
 */
export function buildMenuListSearchParams(query: MenuListQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.page !== 1) {
    params.set("page", String(query.page));
  }
  if (query.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(query.pageSize));
  }
  if (query.category) {
    params.set("category", query.category);
  }
  if (query.search) {
    params.set("q", query.search);
  }
  if (query.sort) {
    params.set("sort", query.sort);
  }
  if (query.order !== "asc") {
    params.set("order", query.order);
  }

  return params;
}
