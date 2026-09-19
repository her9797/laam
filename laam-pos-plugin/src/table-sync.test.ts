import type { PluginHall, PluginTable } from "@tossplace/pos-plugin-sdk";

import { processTableSync, type TableSyncDependencies } from "./table-sync";

const halls: PluginHall[] = [
  { id: 7, title: "1층", order: 0 },
  { id: 8, title: "2층", order: 1 }
];

const tables = [
  { id: 12345, hallId: 7, title: "T01", capacity: 4 },
  { id: 12346, hallId: 8, title: "바1" }
] as Array<PluginTable & { order?: undefined }>;

function dependencies(overrides: Partial<TableSyncDependencies> = {}): TableSyncDependencies {
  return {
    claimTableSync: jest.fn().mockResolvedValue("sync-1"),
    completeTableSync: jest.fn().mockResolvedValue(undefined),
    failTableSync: jest.fn().mockResolvedValue(undefined),
    getHalls: jest.fn().mockResolvedValue(halls),
    getTables: jest.fn().mockResolvedValue(tables),
    ...overrides
  };
}

it("does nothing when no table sync request is waiting", async () => {
  const deps = dependencies({ claimTableSync: jest.fn().mockResolvedValue(undefined) });

  await expect(processTableSync(deps)).resolves.toBe(false);
  expect(deps.completeTableSync).not.toHaveBeenCalled();
  expect(deps.getTables).not.toHaveBeenCalled();
});

it("uploads halls and tables only, without any order information", async () => {
  const withOrders = [
    { id: 12345, hallId: 7, title: "T01", capacity: 4, order: { id: "pos-order-1" } },
    { id: 12346, hallId: 8, title: "바1" }
  ] as unknown as Array<PluginTable & { order?: undefined }>;
  const deps = dependencies({ getTables: jest.fn().mockResolvedValue(withOrders) });

  await expect(processTableSync(deps)).resolves.toBe(true);
  expect(deps.completeTableSync).toHaveBeenCalledWith("sync-1", {
    halls: [
      { id: 7, name: "1층" },
      { id: 8, name: "2층" }
    ],
    tables: [
      { id: 12345, title: "T01", hallId: 7, capacity: 4 },
      { id: 12346, title: "바1", hallId: 8, capacity: null }
    ]
  });
  expect(JSON.stringify((deps.completeTableSync as jest.Mock).mock.calls[0][1])).not.toContain("pos-order-1");
  expect(deps.failTableSync).not.toHaveBeenCalled();
});

it("reports the reason when the POS table snapshot cannot be read", async () => {
  const deps = dependencies({
    getTables: jest.fn().mockRejectedValue(new Error("테이블 API 사용 불가"))
  });

  await expect(processTableSync(deps)).resolves.toBe(false);
  expect(deps.failTableSync).toHaveBeenCalledWith("sync-1", "테이블 API 사용 불가");
  expect(deps.completeTableSync).not.toHaveBeenCalled();
});

it("never throws, so a failed sync cannot stop the next order poll", async () => {
  const claimFailure = dependencies({
    claimTableSync: jest.fn().mockRejectedValue(new Error("network down"))
  });
  await expect(processTableSync(claimFailure)).resolves.toBe(false);

  const reportFailure = dependencies({
    getHalls: jest.fn().mockRejectedValue(new Error("공간 조회 실패")),
    failTableSync: jest.fn().mockRejectedValue(new Error("보고도 실패"))
  });
  await expect(processTableSync(reportFailure)).resolves.toBe(false);
});
