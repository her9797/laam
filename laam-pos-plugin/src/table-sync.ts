import type { PluginHall, PluginOrder, PluginTable } from "@tossplace/pos-plugin-sdk";

import type { TableSnapshot } from "./api-client";

export interface TableSyncDependencies {
  claimTableSync(): Promise<string | undefined>;
  completeTableSync(syncID: string, snapshot: TableSnapshot): Promise<void>;
  failTableSync(syncID: string, message: string): Promise<void>;
  getHalls(): Promise<PluginHall[]>;
  getTables(): Promise<Array<PluginTable & { order?: PluginOrder }>>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "알 수 없는 POS 테이블 동기화 오류";
}

function buildSnapshot(
  halls: PluginHall[],
  tables: Array<PluginTable & { order?: PluginOrder }>
): TableSnapshot {
  // A store with no halls (floor/section grouping) configured resolves
  // getHalls() to `undefined` at runtime, not `[]`, despite the SDK's own
  // type declaring Promise<PluginHall[]> — seen live as "halls.map is not
  // a function". Treat anything that isn't an array as no halls.
  const hallList = Array.isArray(halls) ? halls : [];
  return {
    halls: hallList.map((hall) => ({ id: hall.id, name: hall.title })),
    // 주문 정보는 올리지 않는다. 관리자 화면이 쓰는 값만 담는다.
    tables: tables.map((table) => ({
      id: table.id,
      title: table.title,
      hallId: Number.isSafeInteger(table.hallId) ? table.hallId : null,
      capacity: Number.isSafeInteger(table.capacity) ? (table.capacity as number) : null
    }))
  };
}

/**
 * 대기 중인 테이블 동기화 요청을 한 건 처리한다.
 * 주문 처리 루프를 막지 않도록 어떤 실패에도 예외를 던지지 않는다.
 */
export async function processTableSync(dependencies: TableSyncDependencies): Promise<boolean> {
  let syncID: string | undefined;
  try {
    syncID = await dependencies.claimTableSync();
  } catch (error) {
    console.error("lam POS plugin: table sync claim failed", error);
    return false;
  }
  if (!syncID) {
    return false;
  }

  try {
    const [halls, tables] = [await dependencies.getHalls(), await dependencies.getTables()];
    await dependencies.completeTableSync(syncID, buildSnapshot(halls, tables));
    return true;
  } catch (error) {
    try {
      await dependencies.failTableSync(syncID, errorMessage(error));
    } catch (reportError) {
      console.error("lam POS plugin: failed to report table sync error", reportError);
    }
    return false;
  }
}
