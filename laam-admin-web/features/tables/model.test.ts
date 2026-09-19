import { describe, expect, it } from "vitest";

import { countUnlinkedTables, formatPosTableSummary, groupTablesByArea } from "./model";
import type { AdminTable } from "./model";

/** An unlinked QR table — the shape `GET /admin/tables` returns per entry. */
function buildTable(overrides: Partial<AdminTable> & Pick<AdminTable, "id" | "area" | "number">): AdminTable {
  return {
    qrUrl: `https://example.com/${overrides.id.toLowerCase()}`,
    posTableId: null,
    posTableTitle: null,
    hallName: null,
    linkedAt: null,
    ...overrides,
  };
}

describe("groupTablesByArea", () => {
  it("groups a flat table list into B/T sections, sorted by area then number", () => {
    const tables: AdminTable[] = [
      buildTable({ id: "T-02", area: "T", number: 2 }),
      buildTable({ id: "B-01", area: "B", number: 1 }),
      buildTable({ id: "T-01", area: "T", number: 1 }),
      buildTable({ id: "B-02", area: "B", number: 2 }),
    ];

    const groups = groupTablesByArea(tables);

    expect(groups).toEqual([
      { area: "B", tables: [tables[1], tables[3]] },
      { area: "T", tables: [tables[2], tables[0]] },
    ]);
  });

  it("groups the full 15-table layout into 5 B tables and 10 T tables", () => {
    const tables: AdminTable[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        buildTable({ id: `B-0${i + 1}`, area: "B", number: i + 1 }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        buildTable({ id: `T-${String(i + 1).padStart(2, "0")}`, area: "T", number: i + 1 }),
      ),
    ];

    const groups = groupTablesByArea(tables);

    expect(groups).toHaveLength(2);
    expect(groups[0].tables).toHaveLength(5);
    expect(groups[1].tables).toHaveLength(10);
  });

  it("keeps an area the POS sync introduced that is neither B nor T", () => {
    const tables: AdminTable[] = [
      buildTable({ id: "R-01", area: "R", number: 1 }),
      buildTable({ id: "T-01", area: "T", number: 1 }),
    ];

    expect(groupTablesByArea(tables).map((group) => group.area)).toEqual(["R", "T"]);
  });
});

describe("countUnlinkedTables", () => {
  it("counts only the QR tables with no POS table linked", () => {
    const tables: AdminTable[] = [
      buildTable({ id: "T-01", area: "T", number: 1, posTableId: 11, posTableTitle: "1번" }),
      buildTable({ id: "T-02", area: "T", number: 2 }),
      buildTable({ id: "B-01", area: "B", number: 1 }),
    ];

    expect(countUnlinkedTables(tables)).toBe(2);
  });

  it("returns 0 when every QR table is linked", () => {
    const tables: AdminTable[] = [
      buildTable({ id: "T-01", area: "T", number: 1, posTableId: 11 }),
      buildTable({ id: "B-01", area: "B", number: 1, posTableId: 22 }),
    ];

    expect(countUnlinkedTables(tables)).toBe(0);
  });
});

describe("formatPosTableSummary", () => {
  it("joins the POS table title and its hall name when both are known", () => {
    expect(formatPosTableSummary("1번 테이블", "1층 홀")).toBe("1번 테이블 · 1층 홀");
  });

  it("falls back to the title alone when the hall name is missing", () => {
    expect(formatPosTableSummary("1번 테이블", null)).toBe("1번 테이블");
  });

  it("returns an empty string when there is no title", () => {
    expect(formatPosTableSummary(null, "1층 홀")).toBe("");
  });
});
