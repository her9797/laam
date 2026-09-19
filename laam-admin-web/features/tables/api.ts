import { fetchJson } from "@/lib/api/fetch-json";

import type { AdminTable, AdminTablesData, PosTableSync } from "./model";

const TABLES_PATH = "/api/admin/tables";
const POS_SYNC_PATH = `${TABLES_PATH}/pos-sync`;

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * `GET /admin/tables` grew from `{tables}` to the full table screen payload
 * (link state, POS-only tables, sync state). The defaults below keep this
 * screen working against a server that still answers with the old shape:
 * every POS section then renders as "nothing synced yet" instead of the
 * page erroring out.
 */
export async function fetchAdminTables(): Promise<AdminTablesData> {
  const response = await fetchJson<Partial<AdminTablesData>>(TABLES_PATH, { method: "GET" });
  return {
    tables: response.tables ?? [],
    posOnlyTables: response.posOnlyTables ?? [],
    lastSyncedAt: response.lastSyncedAt ?? null,
    pendingSync: response.pendingSync ?? null,
  };
}

/**
 * Queues a table pull for the POS plugin. Returns the already-queued sync
 * (200) instead of a new one when one is still PENDING/RUNNING.
 */
export function startPosTableSync(): Promise<PosTableSync> {
  return fetchJson<PosTableSync>(POS_SYNC_PATH, { method: "POST" });
}

export function fetchPosTableSync(syncId: string): Promise<PosTableSync> {
  return fetchJson<PosTableSync>(`${POS_SYNC_PATH}/${encodeURIComponent(syncId)}`, {
    method: "GET",
  });
}

/** Links (or, with `null`, unlinks) one QR table. 409 when the POS table is taken. */
export function updateTablePosLink(
  qrTableId: string,
  posTableId: number | null,
): Promise<AdminTable> {
  return fetchJson<AdminTable>(`${TABLES_PATH}/${encodeURIComponent(qrTableId)}/pos-link`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ posTableId }),
  });
}

export type CreateQrTableInput = {
  posTableId: number;
  /** Omitted on the first try: the server derives the id from the POS name, and answers 400 when it can't. */
  id?: string;
};

export function createQrTable(input: CreateQrTableInput): Promise<AdminTable> {
  return fetchJson<AdminTable>(TABLES_PATH, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });
}
