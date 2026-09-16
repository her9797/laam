import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteSpecialRequest, fetchSpecialRequests, fetchSpecialRequestsPage } from "./api";
import type { SpecialRequest, SpecialRequestListQuery, SpecialRequestPageResult } from "./model";

describe("special-requests api", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches the special request list from its own admin BFF resource", async () => {
    const fixture: SpecialRequest[] = [
      {
        id: "special-1",
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const specialRequests = await fetchSpecialRequests();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/special-requests",
      expect.objectContaining({ method: "GET" }),
    );
    expect(specialRequests[0]).toHaveProperty("idealType");
  });

  it("sends delete to the resource path and returns the refreshed list", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const specialRequests = await deleteSpecialRequest("special-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/special-requests/special-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(specialRequests).toEqual([]);
  });

  it("rejects with the upstream status when the request fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "server error" }), { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(fetchSpecialRequests()).rejects.toMatchObject({ status: 500 });
  });

  it("fetches a filtered/sorted/paginated page and encodes every field as a query param", async () => {
    const fixture: SpecialRequestPageResult = { items: [], page: 2, pageSize: 10, total: 0 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const query: SpecialRequestListQuery = {
      page: 2,
      pageSize: 10,
      gender: "female",
      search: "서울",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-08",
      sort: "name",
      order: "asc",
    };
    const result = await fetchSpecialRequestsPage(query);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const requestUrl = new URL(url, "http://localhost");
    expect(requestUrl.pathname).toBe("/api/admin/special-requests");
    expect(requestUrl.searchParams.get("page")).toBe("2");
    expect(requestUrl.searchParams.get("pageSize")).toBe("10");
    expect(requestUrl.searchParams.get("gender")).toBe("female");
    expect(requestUrl.searchParams.get("q")).toBe("서울");
    expect(requestUrl.searchParams.get("sort")).toBe("name");
    expect(requestUrl.searchParams.get("order")).toBe("asc");
    expect(requestUrl.searchParams.get("from")).toBeTruthy();
    expect(requestUrl.searchParams.get("to")).toBeTruthy();
    expect(result).toEqual(fixture);
  });

  it("omits the gender param when no gender filter is set", async () => {
    const fixture: SpecialRequestPageResult = { items: [], page: 1, pageSize: 20, total: 0 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchSpecialRequestsPage({
      page: 1,
      pageSize: 20,
      search: "",
      dateFrom: "",
      dateTo: "",
      sort: "createdAt",
      order: "desc",
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const requestUrl = new URL(url, "http://localhost");
    expect(requestUrl.searchParams.has("gender")).toBe(false);
  });

  it("omits from/to when dateFrom/dateTo are blank", async () => {
    const fixture: SpecialRequestPageResult = { items: [], page: 1, pageSize: 20, total: 0 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchSpecialRequestsPage({
      page: 1,
      pageSize: 20,
      search: "",
      dateFrom: "",
      dateTo: "",
      sort: "createdAt",
      order: "desc",
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const requestUrl = new URL(url, "http://localhost");
    expect(requestUrl.searchParams.has("from")).toBe(false);
    expect(requestUrl.searchParams.has("to")).toBe(false);
  });
});
