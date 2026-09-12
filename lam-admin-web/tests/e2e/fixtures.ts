import { expect, type Page } from "@playwright/test";

import type { AppData } from "@/features/bootstrap/model";
import type { CustomerRequest } from "@/features/requests/model";
import type { SpecialRequest } from "@/features/special-requests/model";

/**
 * Matches this suite's Playwright `webServer.env` (`playwright.config.ts`)
 * and the Vitest test env (`vitest.config.ts`) — the real
 * `/api/auth/admin-login` route runs for real in every test here (it never
 * calls `lam-api`, so it needs no mocking) and accepts this value.
 */
export const ADMIN_PASSWORD = "test-admin-password";

/**
 * Fresh `AppData` each call — field names/shapes match the fixture already
 * verified against `lam-api` in `features/bootstrap/api.test.ts` and reused
 * by `features/menu/MenuManagementPage.test.tsx` /
 * `features/notices/NoticeManagementPage.test.tsx`. Callers must not share
 * one mutable object across tests/routes — construct a new one (or pass
 * `overrides`) per test.
 */
export function buildAppData(overrides: Partial<AppData> = {}): AppData {
  return {
    store: {
      name: "가게",
      subtitle: "",
      address: "",
      songRequestCopy: "",
      requestCopy: "",
      eventCopy: "",
    },
    categories: [{ id: "drinks", label: "음료", isVisible: true }],
    items: [
      {
        id: "menu-1",
        categoryId: "drinks",
        name: "아메리카노",
        description: "시원한 아메리카노",
        price: "4000",
        isVisible: true,
      },
    ],
    requestGuides: [],
    notices: [
      { id: "notice-1", text: "매주 수요일 하이볼 1,000원 할인", isVisible: true },
    ],
    ...overrides,
  };
}

/**
 * Fresh `CustomerRequest[]` each call — shape matches
 * `features/requests/RequestListPage.test.tsx`'s fixture. `r1` is a general
 * request, `r2` a song request (the `[노래 신청]` prefix convention).
 */
export function buildCustomerRequests(): CustomerRequest[] {
  return [
    {
      id: "r1",
      tableNumber: "1",
      text: "물 좀 주세요",
      status: "pending",
      createdAt: "2026-09-03T10:00:00Z",
    },
    {
      id: "r2",
      tableNumber: "2",
      text: "[노래 신청] Dynamite - BTS",
      status: "pending",
      createdAt: "2026-09-03T10:05:00Z",
    },
  ];
}

/**
 * Fresh `SpecialRequest[]` each call — shape matches
 * `features/special-requests/SpecialRequestPage.test.tsx`'s fixture.
 */
export function buildSpecialRequests(): SpecialRequest[] {
  return [
    {
      id: "s1",
      tableNumber: "5",
      gender: "female",
      name: "홍길동",
      age: "20대",
      residence: "서울",
      instagram: "@handle",
      idealType: "친절한 사람",
      text: "소개해주세요",
      createdAt: "2026-09-03T10:00:00Z",
    },
  ];
}

/** Mocks the bootstrap BFF route (`GET /api/bootstrap`). */
export async function mockBootstrap(page: Page, appData: AppData): Promise<void> {
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({ json: appData });
  });
}

/** Mocks the general/song request list route (`GET /api/admin/customer-requests`). */
export async function mockCustomerRequestsList(
  page: Page,
  requests: CustomerRequest[],
): Promise<void> {
  await page.route("**/api/admin/customer-requests", async (route) => {
    await route.fulfill({ json: requests });
  });
}

/**
 * Mocks a status-change PATCH (`PATCH /api/admin/customer-requests/{id}/status`),
 * which per `features/requests/api.ts` returns the full refreshed list.
 *
 * Pass `state` whenever the screen under test reads the *paged* list
 * (`mockCustomerRequestsPage`): `useUpdateCustomerRequestStatusMutation`
 * invalidates `requestsKeys.all` rather than writing this response into the
 * cache (see `features/requests/queries.ts`), so the list refetches right
 * after the PATCH — and without advancing the shared state that refetch
 * would just serve the pre-PATCH rows again.
 */
export async function mockCustomerRequestStatusUpdate(
  page: Page,
  refreshedRequests: CustomerRequest[],
  state?: CustomerRequestListState,
): Promise<void> {
  await page.route("**/api/admin/customer-requests/*/status", async (route) => {
    if (state) {
      state.requests = refreshedRequests;
    }
    await route.fulfill({ json: refreshedRequests });
  });
}

/**
 * Mocks the bulk status-change PATCH (`PATCH /api/admin/customer-requests`,
 * the collection path — see `docs/plans/2026-09-04-admin-request-notifications.md`
 * section 4.5), which returns the full refreshed list, same as the
 * single-id PATCH above. This shares its URL with `mockCustomerRequestsList`
 * (`GET` on the same path), so it must be registered *after* that call in a
 * test: Playwright matches routes most-recently-registered-first, and
 * `route.fallback()` on a non-`PATCH` request here defers to the
 * previously-registered `GET` handler underneath it.
 */
export async function mockCustomerRequestsBulkStatusUpdate(
  page: Page,
  refreshedRequests: CustomerRequest[],
): Promise<void> {
  await page.route("**/api/admin/customer-requests", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: refreshedRequests });
  });
}

/** Mocks the special request list route (`GET /api/admin/special-requests`). */
export async function mockSpecialRequestsList(
  page: Page,
  requests: SpecialRequest[],
): Promise<void> {
  await page.route("**/api/admin/special-requests", async (route) => {
    await route.fulfill({ json: requests });
  });
}

/**
 * Mocks a delete (`DELETE /api/admin/special-requests/{id}`), which per
 * `features/special-requests/api.ts` returns the full refreshed list.
 */
export async function mockSpecialRequestDelete(
  page: Page,
  refreshedRequests: SpecialRequest[],
  state?: SpecialRequestListState,
): Promise<void> {
  await page.route("**/api/admin/special-requests/*", async (route) => {
    if (state) {
      state.requests = refreshedRequests;
    }
    await route.fulfill({ json: refreshedRequests });
  });
}

/**
 * Mutable "server state" for the paged list mocks below. The list route
 * reads `requests` on every call and the mutation mocks
 * (`mockCustomerRequestStatusUpdate`, `mockSpecialRequestDelete`) replace
 * it, so a screen that refetches after a mutation observes the change. A
 * plain array would not: those mutations invalidate their query key instead
 * of writing the response into the cache, so the list always goes back to
 * the network before re-rendering.
 */
export type CustomerRequestListState = { requests: CustomerRequest[] };

export type SpecialRequestListState = { requests: SpecialRequest[] };

const SONG_REQUEST_PREFIX = "[노래 신청]";

/**
 * Mocks the paged general/song request route
 * (`GET /api/admin/customer-requests?...`) that `RequestListPage` uses —
 * distinct from `mockCustomerRequestsList` above, which answers the bare,
 * query-less path the notification bell and dashboard still call. Reaching
 * `lam-api` with any recognized query param switches its response from the
 * plain array to the `{ items, page, pageSize, total }` envelope (see
 * `features/requests/api.ts`'s `fetchCustomerRequestsPage`), so the two
 * shapes need two mocks. The match predicate keys on exactly that — same
 * path, non-empty query string — rather than a glob, so the split is
 * explicit and the two routes can never shadow each other.
 *
 * `kind` and `status` are applied here the way the server applies them
 * (`kind` via the same `[노래 신청]` text-prefix convention
 * `features/dashboard/summary.ts` encodes), so `/requests` and
 * `/song-requests` really do get different rows. The `from`/`to` bounds are
 * deliberately ignored: the screen fills them from a default window
 * relative to today (`RequestListPage`'s mount effect), so honoring them
 * here would make these tests start failing on a date no one chose.
 */
export async function mockCustomerRequestsPage(
  page: Page,
  state: CustomerRequestListState,
): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/admin/customer-requests" && url.search !== "",
    async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const kind = params.get("kind");
      const status = params.get("status");
      const items = state.requests.filter((request) => {
        const isSong = request.text.startsWith(SONG_REQUEST_PREFIX);
        if (kind === "song" && !isSong) {
          return false;
        }
        if (kind === "general" && isSong) {
          return false;
        }
        return !status || request.status === status;
      });
      await route.fulfill({
        json: {
          items,
          page: Number(params.get("page")) || 1,
          pageSize: Number(params.get("pageSize")) || items.length,
          total: items.length,
        },
      });
    },
  );
}

/**
 * Mocks the paged special request route
 * (`GET /api/admin/special-requests?...`) that `SpecialRequestPage` uses —
 * see `mockCustomerRequestsPage` above for why the paged and query-less
 * routes are mocked separately and why the date bounds are ignored.
 */
export async function mockSpecialRequestsPage(
  page: Page,
  state: SpecialRequestListState,
): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/admin/special-requests" && url.search !== "",
    async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const gender = params.get("gender");
      const items = state.requests.filter(
        (request) => !gender || request.gender === gender,
      );
      await route.fulfill({
        json: {
          items,
          page: Number(params.get("page")) || 1,
          pageSize: Number(params.get("pageSize")) || items.length,
          total: items.length,
        },
      });
    },
  );
}

/**
 * Mocks the paginated order list route (`GET /api/admin/payment-orders`).
 *
 * The dashboard's unpaid-order card reads only `total` from this envelope,
 * and it issues one request per unpaid status (`READY`, `ACKNOWLEDGED` — see
 * `features/orders/queries.ts`'s `useOrderCountQuery`), so this matches the
 * path regardless of query string and answers every one of them. `total` is
 * therefore counted once per status: the card shows `total` × the number of
 * unpaid statuses.
 */
export async function mockPaymentOrdersList(page: Page, total = 0): Promise<void> {
  await page.route("**/api/admin/payment-orders?**", async (route) => {
    await route.fulfill({ json: { items: [], page: 1, pageSize: 1, total } });
  });
}

/**
 * Mocks menu item creation (`POST /api/admin/menu-items`), which per
 * `features/menu/api.ts` returns the full refreshed `AppData` tree.
 */
export async function mockCreateMenuItem(page: Page, refreshedAppData: AppData): Promise<void> {
  await page.route("**/api/admin/menu-items", async (route) => {
    await route.fulfill({ json: refreshedAppData });
  });
}

/**
 * Mocks notice creation (`POST /api/admin/notices`), which per
 * `features/notices/api.ts` returns the full refreshed `AppData` tree.
 */
export async function mockCreateNotice(page: Page, refreshedAppData: AppData): Promise<void> {
  await page.route("**/api/admin/notices", async (route) => {
    await route.fulfill({ json: refreshedAppData });
  });
}

/**
 * Mocks every query the dashboard route needs (bootstrap, customer
 * requests, special requests) with fresh default fixtures unless
 * `overrides` supplies its own — call this before `loginAsAdmin` in any
 * test whose flow passes through `/dashboard`, so that transient landing
 * on it after login never hits the real (deliberately unreachable)
 * `lam-api` origin.
 */
export async function mockDashboardData(
  page: Page,
  overrides: {
    appData?: AppData;
    requests?: CustomerRequest[];
    specialRequests?: SpecialRequest[];
    orderCount?: number;
  } = {},
): Promise<void> {
  await mockBootstrap(page, overrides.appData ?? buildAppData());
  await mockCustomerRequestsList(page, overrides.requests ?? buildCustomerRequests());
  await mockSpecialRequestsList(page, overrides.specialRequests ?? buildSpecialRequests());
  // The dashboard renders an error state if any of its queries fails, so the
  // unpaid-order card's request must be mocked here too — without it the
  // whole screen fails to render and every assertion on the dashboard (page
  // heading included) misses, no matter what the test is actually about.
  await mockPaymentOrdersList(page, overrides.orderCount ?? 0);
}

/**
 * Logs in through the real `/api/auth/admin-login` route (never mocked —
 * see `ADMIN_PASSWORD`'s doc comment) and waits for the redirect to
 * `/dashboard`. Callers must mock the dashboard's own data (e.g. via
 * `mockDashboardData`) beforehand if they want the landing render to
 * succeed rather than show an error state.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("비밀번호").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
