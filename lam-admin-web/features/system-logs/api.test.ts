import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSystemLogsPage } from "./api";
import type { SystemLogPageResult } from "./model";

describe("system logs api", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches a page of system logs from the admin BFF, encoding page and pageSize", async () => {
    const fixture: SystemLogPageResult = {
      items: [
        {
          id: "log-1",
          method: "GET",
          path: "/api/v1/admin/orders",
          status: 500,
          message: "internal server error",
          createdAt: "2026-09-03T10:00:00Z",
        },
      ],
      page: 2,
      pageSize: 10,
      total: 21,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchSystemLogsPage({ page: 2, pageSize: 10 });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const requestUrl = new URL(url, "http://localhost");
    expect(requestUrl.pathname).toBe("/api/admin/system-logs");
    expect(requestUrl.searchParams.get("page")).toBe("2");
    expect(requestUrl.searchParams.get("pageSize")).toBe("10");
    expect(result).toEqual(fixture);
  });

  it("rejects with the upstream status when the request fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "server error" }), { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(fetchSystemLogsPage({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      status: 500,
    });
  });
});
