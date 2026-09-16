/**
 * Mirrors `laam-api/internal/httpapi.adminTable` / `adminTablesResponse`. This
 * is a read-only view over the fixed physical table layout (`B-01..05`,
 * `T-01..10`) — there is no create/update/delete flow, only QR display and
 * export.
 */
export type TableArea = "B" | "T";

export type AdminTable = {
  id: string;
  area: TableArea;
  number: number;
  qrUrl: string;
};

export type AdminTableGroup = {
  area: TableArea;
  tables: AdminTable[];
};

/**
 * Groups the flat list the API returns into per-area sections, in area
 * order (`B` before `T`) and ascending table number within each area — the
 * order the response is already in, but re-sorted here so the UI doesn't
 * depend on the server never reordering it.
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
