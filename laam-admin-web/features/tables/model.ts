/**
 * Mirrors `laam-api`'s `GET /admin/tables` payload.
 *
 * A *QR table* is the name printed on the customer's QR code (`T-01`,
 * `B-03`); a *POS table* is Toss POS's own numeric table id. The two are
 * linked one-to-one, and a QR table with no POS table behind it cannot take
 * customer orders at all — which is why this screen shows link state
 * alongside the QR codes it always showed.
 */
export type TableArea = string;

export type AdminTable = {
  id: string;
  area: TableArea;
  number: number;
  qrUrl: string;
  /** `null` while this QR table is not linked to any POS table. */
  posTableId: number | null;
  /** Snapshot of the linked POS table's name, taken at link time. */
  posTableTitle: string | null;
  hallName: string | null;
  linkedAt: string | null;
};

/** One table in the POS snapshot the plugin last uploaded. */
export type PosTable = {
  posTableId: number;
  title: string;
  hallId: number | null;
  hallName: string | null;
  capacity: number | null;
  syncedAt: string;
  /** The QR table this POS table is linked to, or `null` when POS-only. */
  qrTableId: string | null;
};

export type PosTableSyncStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "TIMED_OUT";

/** One "pull the table list from the POS plugin" request and its outcome. */
export type PosTableSync = {
  id: string;
  status: PosTableSyncStatus;
  requestedAt: string;
  completedAt: string | null;
  linkedCount: number;
  unlinkedCount: number;
  posOnlyCount: number;
  error: string | null;
};

export type AdminTablesData = {
  tables: AdminTable[];
  /** POS tables with no QR table of their own yet. */
  posOnlyTables: PosTable[];
  lastSyncedAt: string | null;
  /** A sync still in flight when the page loaded, if any. */
  pendingSync: PosTableSync | null;
};

export type AdminTableGroup = {
  area: TableArea;
  tables: AdminTable[];
};

/**
 * Groups the flat list the API returns into per-area sections, in area
 * order (`B` before `T`) and ascending table number within each area — the
 * order the response is already in, but re-sorted here so the UI doesn't
 * depend on the server never reordering it. Areas are not limited to `B`/`T`:
 * a table added from the POS snapshot can carry any area letter.
 */
export function groupTablesByArea(tables: AdminTable[]): AdminTableGroup[] {
  const byArea = new Map<TableArea, AdminTable[]>();
  for (const table of tables) {
    const group = byArea.get(table.area);
    if (group) {
      group.push(table);
    } else {
      byArea.set(table.area, [table]);
    }
  }
  return Array.from(byArea.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, groupTables]) => ({
      area,
      tables: [...groupTables].sort((a, b) => a.number - b.number),
    }));
}

/** How many QR tables still have no POS table behind them — i.e. cannot be ordered from. */
export function countUnlinkedTables(tables: AdminTable[]): number {
  return tables.filter((table) => table.posTableId === null).length;
}

/**
 * The one-line "which POS table is this" label: the POS table's name, plus
 * its hall when the POS reported one. Empty when there is no name to show,
 * so callers can fall back to the unlinked state.
 */
export function formatPosTableSummary(title: string | null, hallName: string | null): string {
  if (!title) {
    return "";
  }
  return hallName ? `${title} · ${hallName}` : title;
}
