import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAdminTables } from "./api";
import type { AdminTable } from "./model";

describe("tables api", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches the table list from the admin BFF and returns the tables array", async () => {
    const fixture: AdminTable[] = [
      { id: "B-01", area: "B", number: 1, qrUrl: "https://example.com/qr/enter?table=B-01&sig=abc" },
      { id: "T-01", area: "T", number: 1, qrUrl: "https://example.com/qr/enter?table=T-01&sig=def" },
    ];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ tables: fixture }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const tables = await fetchAdminTables();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tables",
      expect.objectContaining({ method: "GET" }),
    );
    expect(tables).toEqual(fixture);
  });

  it("rejects with the upstream status when the request fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "server error" }), { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(fetchAdminTables()).rejects.toMatchObject({ status: 500 });
  });
});
