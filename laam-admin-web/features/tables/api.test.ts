import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createQrTable,
  fetchAdminTables,
  fetchPosTableSync,
  startPosTableSync,
  updateTablePosLink,
} from "./api";
import type { AdminTable, AdminTablesData, PosTable, PosTableSync } from "./model";

function buildTable(
  overrides: Partial<AdminTable> & Pick<AdminTable, "id" | "area" | "number">,
): AdminTable {
  return {
    qrUrl: `https://example.com/qr/enter?table=${overrides.id}&sig=abc`,
    posTableId: null,
    posTableTitle: null,
    hallName: null,
    linkedAt: null,
    ...overrides,
  };
}

function buildSync(overrides: Partial<PosTableSync> = {}): PosTableSync {
  return {
    id: "sync-1",
    status: "PENDING",
    requestedAt: "2026-09-19T00:00:00Z",
    completedAt: null,
    linkedCount: 0,
    unlinkedCount: 0,
    posOnlyCount: 0,
    error: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("tables api", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(response: Response) {
    const fetchMock = vi.fn(async () => response);
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("fetches the full table screen payload from the admin BFF", async () => {
    const tables = [
      buildTable({
        id: "T-01",
        area: "T",
        number: 1,
        posTableId: 11,
        posTableTitle: "1번 테이블",
        hallName: "1층",
        linkedAt: "2026-09-19T00:00:00Z",
      }),
    ];
    const posOnlyTables: PosTable[] = [
      {
        posTableId: 22,
        title: "룸1",
        hallId: 3,
        hallName: "2층",
        capacity: 4,
        syncedAt: "2026-09-19T00:00:00Z",
        qrTableId: null,
      },
    ];
    const payload: AdminTablesData = {
      tables,
      posOnlyTables,
      lastSyncedAt: "2026-09-19T00:00:00Z",
      pendingSync: null,
    };
    const fetchMock = mockFetch(jsonResponse(payload));

    await expect(fetchAdminTables()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tables",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fills in the POS fields when the server still returns only a table list", async () => {
    // The server side of this feature may ship after this screen does; the
    // old `{tables:[...]}` response must not blank the page out.
    mockFetch(jsonResponse({ tables: [buildTable({ id: "B-01", area: "B", number: 1 })] }));

    await expect(fetchAdminTables()).resolves.toEqual({
      tables: [buildTable({ id: "B-01", area: "B", number: 1 })],
      posOnlyTables: [],
      lastSyncedAt: null,
      pendingSync: null,
    });
  });

  it("rejects with the upstream status when the request fails", async () => {
    mockFetch(jsonResponse({ error: "server error" }, 500));

    await expect(fetchAdminTables()).rejects.toMatchObject({ status: 500 });
  });

  it("requests a new POS table sync", async () => {
    const sync = buildSync();
    const fetchMock = mockFetch(jsonResponse(sync, 201));

    await expect(startPosTableSync()).resolves.toEqual(sync);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tables/pos-sync",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reads one POS table sync by id", async () => {
    const sync = buildSync({ status: "DONE", linkedCount: 3 });
    const fetchMock = mockFetch(jsonResponse(sync));

    await expect(fetchPosTableSync("sync 1")).resolves.toEqual(sync);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tables/pos-sync/sync%201",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("links a QR table to a POS table", async () => {
    const linked = buildTable({
      id: "T-01",
      area: "T",
      number: 1,
      posTableId: 11,
      posTableTitle: "1번",
    });
    const fetchMock = mockFetch(jsonResponse(linked));

    await expect(updateTablePosLink("T-01", 11)).resolves.toEqual(linked);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tables/T-01/pos-link",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ posTableId: 11 }) }),
    );
  });

  it("unlinks a QR table by sending a null POS table id", async () => {
    const unlinked = buildTable({ id: "T-01", area: "T", number: 1 });
    const fetchMock = mockFetch(jsonResponse(unlinked));

    await expect(updateTablePosLink("T-01", null)).resolves.toEqual(unlinked);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tables/T-01/pos-link",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ posTableId: null }) }),
    );
  });

  it("rejects with 409 when the POS table is already linked elsewhere", async () => {
    mockFetch(jsonResponse({ error: "already linked" }, 409));

    await expect(updateTablePosLink("T-01", 11)).rejects.toMatchObject({ status: 409 });
  });

  it("creates a QR table from a POS table, letting the server name it", async () => {
    const created = buildTable({ id: "T-11", area: "T", number: 11, posTableId: 11 });
    const fetchMock = mockFetch(jsonResponse(created, 201));

    await expect(createQrTable({ posTableId: 11 })).resolves.toEqual(created);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tables",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ posTableId: 11 }) }),
    );
  });

  it("creates a QR table with the id the operator typed", async () => {
    const created = buildTable({ id: "T-11", area: "T", number: 11, posTableId: 11 });
    const fetchMock = mockFetch(jsonResponse(created, 201));

    await createQrTable({ posTableId: 11, id: "T-11" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tables",
      expect.objectContaining({ body: JSON.stringify({ posTableId: 11, id: "T-11" }) }),
    );
  });
});
