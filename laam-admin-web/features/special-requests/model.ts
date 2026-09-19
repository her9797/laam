/**
 * Mirrors `laam-api/internal/lamdata.SpecialRequest`. This is the
 * `special_requests` feature boundary — kept fully separate from
 * `features/requests` (`customer_requests`): no shared model, API path, or
 * query key, per this repo's `AGENTS.md` rule and the plan's Task 4 brief.
 */
export type SpecialRequest = {
  id: string;
  tableNumber: string;
  gender: string;
  name: string;
  age: string;
  residence: string;
  instagram: string;
  idealHeight: string;
  idealResidence: string;
  idealAgeRange: string;
  idealDetails: string;
  text: string;
  createdAt: string;
};

export type SpecialRequestGender = "male" | "female";

export type SpecialRequestSort = "createdAt" | "name";

export type SortOrder = "asc" | "desc";

/**
 * Unlike `features/requests`' `CustomerRequestListQuery`, this is
 * deliberately never serialized to the URL — the `search` field can hold a
 * guest's name or contact info, and this screen's existing detail/delete
 * dialogs already keep that data out of the address bar and browser
 * history on purpose (see `SpecialRequestPage`'s doc comment).
 *
 * There is deliberately no date bound here: unlike `features/requests`, this
 * screen lists every special request, all-time. The endpoint still accepts
 * `from`/`to`, but nothing in this feature sends them.
 */
export type SpecialRequestListQuery = {
  page: number;
  pageSize: number;
  gender?: SpecialRequestGender;
  search: string;
  sort: SpecialRequestSort;
  order: SortOrder;
};

/** Mirrors `laam-api/internal/lamdata.SpecialRequestPage`. */
export type SpecialRequestPageResult = {
  items: SpecialRequest[];
  page: number;
  pageSize: number;
  total: number;
};
