import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchCustomerRequests,
  fetchCustomerRequestsPage,
  updateCustomerRequestStatus,
  updateCustomerRequestStatuses,
} from "./api";
import type { CustomerRequest, CustomerRequestListQuery, CustomerRequestPageResult } from "./model";

describe("requests api", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches the general/song request list from the admin BFF", async () => {
    const fixture: CustomerRequest[] = [
      {
        id: "req-1",
        tableNumber: "3",
        text: "물 좀 주세요",
        status: "pending",
        createdAt: "2026-09-03T10:00:00Z",
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const requests = await fetchCustomerRequests();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/customer-requests",
      expect.objectContaining({ method: "GET" }),
    );
    expect(requests[0]).toMatchObject({ id: "req-1", status: "pending" });
  });

  it("sends a status update as a PATCH to the resource path and returns the refreshed list", async () => {
    const fixture: CustomerRequest[] = [
      {
        id: "req-1",
        tableNumber: "3",
        text: "물 좀 주세요",
        status: "checked",
        createdAt: "2026-09-03T10:00:00Z",
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const requests = await updateCustomerRequestStatus("req-1", "checked");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/customer-requests/req-1/status");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ status: "checked" });
    expect(requests[0]).toMatchObject({ id: "req-1", status: "checked" });
  });

  it("rejects with the upstream status when the request fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "server error" }), { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(fetchCustomerRequests()).rejects.toMatchObject({ status: 500 });
  });

  it("sends a bulk status update as a PATCH to the collection path and returns the refreshed list", async () => {
    const fixture: CustomerRequest[] = [
      {
        id: "req-1",
        tableNumber: "3",
        text: "물 좀 주세요",
        status: "checked",
        createdAt: "2026-09-03T10:00:00Z",
      },
      {
        id: "req-2",
        tableNumber: "5",
        text: "냅킨 주세요",
        status: "checked",
        createdAt: "2026-09-03T10:01:00Z",
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const requests = await updateCustomerRequestStatuses(["req-1", "req-2"], "checked");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/customer-requests");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ ids: ["req-1", "req-2"], status: "checked" });
    expect(requests).toHaveLength(2);
  });

  it("fetches a filtered/sorted/paginated page and encodes every field as a query param", async () => {
    const fixture: CustomerRequestPageResult = {
      items: [],
      page: 2,
      pageSize: 10,
      total: 0,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const query: CustomerRequestListQuery = {
      page: 2,
      pageSize: 10,
      status: "pending",
      kind: "song",
      search: "물",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-08",
      sort: "createdAt",
      order: "desc",
    };
    const result = await fetchCustomerRequestsPage(query);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const requestUrl = new URL(url, "http://localhost");
    expect(requestUrl.pathname).toBe("/api/admin/customer-requests");
    expect(requestUrl.searchParams.get("page")).toBe("2");
    expect(requestUrl.searchParams.get("pageSize")).toBe("10");
    expect(requestUrl.searchParams.get("status")).toBe("pending");
    expect(requestUrl.searchParams.get("kind")).toBe("song");
    expect(requestUrl.searchParams.get("q")).toBe("물");
    expect(requestUrl.searchParams.get("sort")).toBe("createdAt");
    expect(requestUrl.searchParams.get("order")).toBe("desc");
    expect(requestUrl.searchParams.get("from")).toBeTruthy();
    expect(requestUrl.searchParams.get("to")).toBeTruthy();
    expect(result).toEqual(fixture);
  });

  it("omits the status param when no status filter is set", async () => {
    const fixture: CustomerRequestPageResult = { items: [], page: 1, pageSize: 20, total: 0 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchCustomerRequestsPage({
      page: 1,
      pageSize: 20,
      kind: "all",
      search: "",
      dateFrom: "",
      dateTo: "",
      sort: "status",
      order: "asc",
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const requestUrl = new URL(url, "http://localhost");
    expect(requestUrl.searchParams.has("status")).toBe(false);
  });

  it("omits from/to when dateFrom/dateTo are blank", async () => {
    const fixture: CustomerRequestPageResult = { items: [], page: 1, pageSize: 20, total: 0 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchCustomerRequestsPage({
      page: 1,
      pageSize: 20,
      kind: "all",
      search: "",
      dateFrom: "",
      dateTo: "",
      sort: "status",
      order: "asc",
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const requestUrl = new URL(url, "http://localhost");
    expect(requestUrl.searchParams.has("from")).toBe(false);
    expect(requestUrl.searchParams.has("to")).toBe(false);
  });
});
