import { describe, expect, it } from "vitest";

import { groupTablesByArea } from "./model";
import type { AdminTable } from "./model";

describe("groupTablesByArea", () => {
  it("groups a flat table list into B/T sections, sorted by area then number", () => {
    const tables: AdminTable[] = [
      { id: "T-02", area: "T", number: 2, qrUrl: "https://example.com/t2" },
      { id: "B-01", area: "B", number: 1, qrUrl: "https://example.com/b1" },
      { id: "T-01", area: "T", number: 1, qrUrl: "https://example.com/t1" },
      { id: "B-02", area: "B", number: 2, qrUrl: "https://example.com/b2" },
    ];

    const groups = groupTablesByArea(tables);

    expect(groups).toEqual([
      { area: "B", tables: [tables[1], tables[3]] },
      { area: "T", tables: [tables[2], tables[0]] },
    ]);
  });

  it("groups the full 15-table layout into 5 B tables and 10 T tables", () => {
    const tables: AdminTable[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `B-0${i + 1}`,
        area: "B" as const,
        number: i + 1,
        qrUrl: `https://example.com/b${i + 1}`,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `T-${String(i + 1).padStart(2, "0")}`,
        area: "T" as const,
        number: i + 1,
        qrUrl: `https://example.com/t${i + 1}`,
      })),
    ];

    const groups = groupTablesByArea(tables);

    expect(groups).toHaveLength(2);
    expect(groups[0].tables).toHaveLength(5);
    expect(groups[1].tables).toHaveLength(10);
  });
});
