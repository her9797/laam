import { expect, type Page } from "@playwright/test";

import type { AppData } from "@/features/bootstrap/model";
import type { PaymentOrder } from "@/features/orders/model";
import type { CustomerRequest } from "@/features/requests/model";
import type { SpecialRequest } from "@/features/special-requests/model";
import type { SystemLog } from "@/features/system-logs/model";

/**
 * Matches this suite's Playwright `webServer.env` (`playwright.config.ts`)
 * and the Vitest test env (`vitest.config.ts`) — the real
 * `/api/auth/admin-login` route runs for real in every test here (it never
 * calls `laam-api`, so it needs no mocking) and accepts this value.
 */
export const ADMIN_PASSWORD = "test-admin-password";

/**
 * Fresh `AppData` each call — field names/shapes match the fixture already
 * verified against `laam-api` in `features/bootstrap/api.test.ts` and reused
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
      idealHeight: "180 이상",
      idealResidence: "강남",
      idealAgeRange: "20대 초반",
      idealDetails: "친절한 사람",
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

/**
 * Mocks the notification bell/dashboard summary route
 * (`GET /api/admin/customer-requests/pending-summary`), deriving the pending
 * general/song counts and newest-first pending items from `requests` the way
 * `laam-api` does (same `[노래 신청]` prefix rule).
 */
export async function mockCustomerRequestPendingSummary(
  page: Page,
  requests: CustomerRequest[],
): Promise<void> {
  await page.route("**/api/admin/customer-requests/pending-summary", async (route) => {
    const pending = requests
      .filter((request) => request.status === "pending")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const songCount = pending.filter((request) => request.text.startsWith(SONG_REQUEST_PREFIX)).length;
    await route.fulfill({
      json: {
        pendingGeneralCount: pending.length - songCount,
        pendingSongCount: songCount,
        items: pending,
      },
    });
  });
}

/**
 * Mocks a status-change PATCH (`PATCH /api/admin/customer-requests/{id}/status`),
 * which answers 204 No Content.
 *
 * Pass `state` whenever the screen under test reads the *paged* list
 * (`mockCustomerRequestsPage`): `useUpdateCustomerRequestStatusMutation`
 * invalidates `requestsKeys.all` (see `features/requests/queries.ts`), so
 * the list refetches right after the PATCH — and without advancing the shared state that refetch
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
    await route.fulfill({ status: 204 });
  });
}

/**
 * Mocks the bulk status-change PATCH (`PATCH /api/admin/customer-requests`,
 * the collection path — see `docs/plans/2026-09-04-admin-request-notifications.md`
 * section 4.5), which answers 204 No Content, same as the single-id PATCH
 * above. `route.fallback()` on a non-`PATCH` request here defers to any
 * previously-registered handler for the same path, so register it *after*
 * those (Playwright matches routes most-recently-registered-first).
 */
export async function mockCustomerRequestsBulkStatusUpdate(page: Page): Promise<void> {
  await page.route("**/api/admin/customer-requests", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 204 });
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
 * Mocks a delete (`DELETE /api/admin/special-requests/{id}`), which answers
 * 204 No Content. `refreshedRequests` only advances `state` so a paged list
 * refetch after the delete observes it.
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
    await route.fulfill({ status: 204 });
  });
}

/**
 * Mutable "server state" for the paged list mocks below. The list route
 * reads `requests` on every call and the mutation mocks
 * (`mockCustomerRequestStatusUpdate`, `mockSpecialRequestDelete`) replace
 * it, so a screen that refetches after a mutation observes the change. A
 * plain array would not: those mutations answer 204 and invalidate their
 * query key, so the list always goes back to the network before re-rendering.
 */
export type CustomerRequestListState = { requests: CustomerRequest[] };

export type SpecialRequestListState = { requests: SpecialRequest[] };

const SONG_REQUEST_PREFIX = "[노래 신청]";

/**
 * Mocks the paged general/song request route
 * (`GET /api/admin/customer-requests?...`) that `RequestListPage` uses.
 * Reaching `laam-api` with any recognized query param switches its response
 * from the legacy plain array to the `{ items, page, pageSize, total }`
 * envelope (see `features/requests/api.ts`'s `fetchCustomerRequestsPage`).
 * The match predicate keys on exactly that — same path, non-empty query
 * string — rather than a glob, so it never shadows the bare path's PATCH.
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
 * `laam-api` origin.
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
  const specialRequests = overrides.specialRequests ?? buildSpecialRequests();
  await mockBootstrap(page, overrides.appData ?? buildAppData());
  await mockCustomerRequestPendingSummary(page, overrides.requests ?? buildCustomerRequests());
  // Kept for any test that still reads the bare, query-less list directly —
  // nothing on the dashboard itself does since `useSpecialRequestCountQuery`
  // below replaced its old full-list read.
  await mockSpecialRequestsList(page, specialRequests);
  // The dashboard's special-request card reads only `total` from the paged
  // envelope (`features/special-requests/queries.ts`'s
  // `useSpecialRequestCountQuery`, pageSize 1, no filters) — a *different*
  // route (path + non-empty query string) from the bare list mocked just
  // above, so it needs its own mock or the dashboard's load hangs against
  // this suite's deliberately unreachable real API origin. Matches
  // `mockPaymentOrdersList`'s same path-regardless-of-query-string shape.
  await page.route("**/api/admin/special-requests?**", async (route) => {
    await route.fulfill({ json: { items: [], page: 1, pageSize: 1, total: specialRequests.length } });
  });
  // The dashboard renders an error state if any of its queries fails, so the
  // unpaid-order card's request must be mocked here too — without it the
  // whole screen fails to render and every assertion on the dashboard (page
  // heading included) misses, no matter what the test is actually about.
  await mockPaymentOrdersList(page, overrides.orderCount ?? 0);
  // The expense/inventory shortcut cards (`features/dashboard/DashboardPage.tsx`).
  await page.route("**/api/admin/expenses/summary?**", async (route) => {
    const month = new URL(route.request().url()).searchParams.get("month") ?? "";
    await route.fulfill({
      json: { month, total: 0, previousMonthTotal: 0, receiptCount: 0, byCategory: [] },
    });
  });
  await page.route("**/api/admin/inventory/summary", async (route) => {
    await route.fulfill({ json: { reorderCount: 0, needsCheckCount: 0 } });
  });
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

/**
 * Fresh `PaymentOrder[]` each call — field names/shapes match
 * `features/orders/model.ts`'s `PaymentOrder` (mirrors `laam-api`).
 */
export function buildPaymentOrders(): PaymentOrder[] {
  return [
    {
      orderId: "order-1",
      menuItemId: "menu-1",
      menuItemName: "아메리카노",
      categoryName: "음료",
      tableNumber: "3",
      requestNote: "얼음 적게 주세요",
      amount: 4000,
      vat: 364,
      suppliedAmount: 3636,
      taxFreeAmount: 0,
      status: "READY",
      paymentMethod: "CARD",
      approvedAt: "2026-09-03T10:00:00Z",
      posSyncStatus: "SUCCEEDED",
      createdAt: "2026-09-03T10:00:00Z",
    },
  ];
}

/**
 * Mocks the paginated order list route (`GET /api/admin/payment-orders?...`)
 * with real rows, for `/orders`. Same path-regardless-of-query-string match
 * as `mockPaymentOrdersList`; register it after `mockDashboardData` so it
 * takes precedence (Playwright matches most-recently-registered first).
 */
export async function mockPaymentOrdersPage(page: Page, orders: PaymentOrder[]): Promise<void> {
  await page.route("**/api/admin/payment-orders?**", async (route) => {
    await route.fulfill({
      json: { items: orders, page: 1, pageSize: 20, total: orders.length },
    });
  });
}

/** Fresh `SystemLog[]` each call — shape matches `features/system-logs/model.ts`. */
export function buildSystemLogs(): SystemLog[] {
  return [
    {
      id: "log-1",
      method: "GET",
      path: "/api/v1/admin/payment-orders",
      status: 502,
      message: "upstream POS request failed",
      createdAt: "2026-09-03T10:00:00Z",
    },
  ];
}

/** Mocks the paged system log route (`GET /api/admin/system-logs?...`). */
export async function mockSystemLogsPage(page: Page, logs: SystemLog[]): Promise<void> {
  await page.route("**/api/admin/system-logs?**", async (route) => {
    await route.fulfill({
      json: { items: logs, page: 1, pageSize: 20, total: logs.length },
    });
  });
}
