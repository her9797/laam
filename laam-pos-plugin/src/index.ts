import type { PosPluginSdk } from "@tossplace/pos-plugin-sdk";

import { loadRealtimeConfig, POSAPIClient } from "./api-client";
import { syncClaim, type TableMappings } from "./order-sync";
import { processNextClaim } from "./processor";
import { PhoenixRealtimeClient } from "./realtime";
import { ensureWorkerGlobal } from "./runtime-global";
import { SyncScheduler, type OrderStepResult } from "./scheduler";
import { TableMappingCache } from "./table-mappings";
import { processTableSync } from "./table-sync";

// 실시간 신호가 끊겼거나 꺼져 있을 때의 폴링 주기(기존 폴링과 같음).
const DISCONNECTED_POLL_MS = 3_000;
// 실시간 신호가 연결돼 있을 때의 예비 폴링 주기. 서버 설정이 우선한다.
const DEFAULT_CONNECTED_POLL_MS = 60_000;
// 설정이 비어 있거나 잘못됐을 때 실시간 설정을 다시 읽는 주기.
const SETTINGS_RETRY_MS = 30_000;
// 실시간이 꺼져 있을 때(옛 API 포함) 켜졌는지 다시 확인하는 주기.
const REALTIME_CONFIG_RECHECK_MS = 10 * 60_000;
const processedKey = (orderID: string) => `lam:processed-order:${orderID}`;

// 처리할 때마다 매핑을 다시 받지 않도록 처리 루프 밖에서 캐시를 유지한다.
const mappingCache = new TableMappingCache();

// Hardcoded independently of the plugin's own settings screen so a crash
// that happens before those settings can even be read (SDK import,
// setInputs) still reaches laam-api. Toss gives no other way to see a
// deployed worker plugin's console short of wiring up Sentry.
const DIAGNOSTICS_URL = "https://laam-api-760602987859.asia-northeast3.run.app/api/v1/pos-plugin/diagnostics";

interface PluginSettings extends Record<string, string | number | boolean | string[] | undefined> {
  apiBaseUrl?: string;
  apiToken?: string;
  tableMappings?: string;
}

function reportCrash(stage: string, error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  try {
    void fetch(DIAGNOSTICS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, message })
    }).catch(() => {});
  } catch {
    // Nothing more we can do if even fetch is unavailable in this sandbox.
  }
}

function parseTableMappings(value: string | undefined): TableMappings {
  if (!value?.trim()) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("테이블 매핑은 JSON 객체여야 함");
  }

  const mappings: TableMappings = {};
  for (const [tableNumber, tableID] of Object.entries(parsed)) {
    if (!Number.isSafeInteger(tableID) || Number(tableID) <= 0) {
      throw new Error(`유효하지 않은 테이블 ID: ${tableNumber}`);
    }
    mappings[tableNumber] = Number(tableID);
  }
  return mappings;
}

async function configureSettings(sdk: PosPluginSdk): Promise<void> {
  await sdk.setting.setInputs([
    {
      id: "apiBaseUrl",
      type: "text",
      label: "laam-api 주소",
      required: true,
      default: "",
      placeholder: "https://laam-api-...run.app"
    },
    {
      id: "apiToken",
      type: "password",
      label: "POS 플러그인 API 토큰",
      required: true,
      default: "",
      placeholder: "Secret Manager의 laam-pos-plugin-api-token 값"
    },
    {
      id: "tableMappings",
      type: "text",
      label: "예비 테이블 매핑 JSON (서버 연결을 못 쓸 때만 사용)",
      required: false,
      default: "{}",
      placeholder: "평소에는 비워 둡니다. 예: {\"T-01\": 12345}"
    }
  ]);
}

interface APIContext {
  api: POSAPIClient;
  settings: PluginSettings;
}

// 설정은 매번 새로 읽어 POS에서 바꾼 주소·토큰이 바로 반영되게 한다.
async function readAPIContext(sdk: PosPluginSdk): Promise<APIContext | undefined> {
  const settings = await sdk.setting.getValues<PluginSettings>();
  const baseURL = settings.apiBaseUrl?.trim() ?? "";
  const token = settings.apiToken?.trim() ?? "";
  if (!baseURL || !token) {
    return undefined;
  }
  return { api: new POSAPIClient(sdk.http, baseURL, token), settings };
}

async function processOrderStep(sdk: PosPluginSdk): Promise<OrderStepResult> {
  const context = await readAPIContext(sdk);
  if (!context) {
    return { processed: false, tableSyncPending: false };
  }
  const { api, settings } = context;
  const fallbackMappings = parseTableMappings(settings.tableMappings);

  let tableSyncPending: boolean | undefined;
  const processed = await processNextClaim({
    claim: async () => {
      const result = await api.claim();
      tableSyncPending = result.tableSyncPending;
      return result.claim;
    },
    complete: (orderID, claimToken, posOrderID) => api.complete(orderID, claimToken, posOrderID),
    fail: (orderID, claimToken, message) => api.fail(orderID, claimToken, message),
    getProcessedPOSOrderID: (orderID) => sdk.secureStore.get(processedKey(orderID)),
    rememberProcessedPOSOrderID: (orderID, posOrderID) =>
      sdk.secureStore.set(processedKey(orderID), posOrderID),
    syncToPOS: async (claim) =>
      syncClaim(
        {
          getTables: () => sdk.table.getTables(),
          getCatalog: (id) => sdk.catalog.getCatalog(id),
          add: (order) => sdk.order.add(order),
          addMenu: (orderID, order) => sdk.order.addMenu(orderID, order)
        },
        claim,
        await mappingCache.resolve(() => api.fetchTableMappings(), fallbackMappings)
      )
  });
  return { processed, tableSyncPending };
}

async function processTableSyncStep(sdk: PosPluginSdk): Promise<void> {
  const context = await readAPIContext(sdk);
  if (!context) {
    return;
  }
  const { api } = context;
  // processTableSync는 예외를 던지지 않으므로 주문 처리를 막지 않는다.
  await processTableSync({
    claimTableSync: () => api.claimTableSync(),
    completeTableSync: (syncID, snapshot) => api.completeTableSync(syncID, snapshot),
    failTableSync: (syncID, message) => api.failTableSync(syncID, message),
    getHalls: () => sdk.table.getHalls(),
    getTables: () => sdk.table.getTables()
  });
}

async function startRealtime(sdk: PosPluginSdk, scheduler: SyncScheduler): Promise<void> {
  const retry = (delayMs: number) => setTimeout(() => void startRealtime(sdk, scheduler), delayMs);

  let context: APIContext | undefined;
  try {
    context = await readAPIContext(sdk);
  } catch (error) {
    console.warn("lam POS plugin: realtime setup waiting for valid settings", error);
  }
  if (!context) {
    retry(SETTINGS_RETRY_MS);
    return;
  }

  const config = await loadRealtimeConfig(context.api);
  if (!config.enabled) {
    scheduler.setPollIntervals({
      connectedMs: DEFAULT_CONNECTED_POLL_MS,
      disconnectedMs: config.fallbackPollSeconds * 1000
    });
    retry(REALTIME_CONFIG_RECHECK_MS);
    return;
  }

  scheduler.setPollIntervals({
    connectedMs: config.fallbackPollSeconds * 1000,
    disconnectedMs: DISCONNECTED_POLL_MS
  });
  const realtime = new PhoenixRealtimeClient(
    { url: config.url, apiKey: config.apiKey, topic: config.topic },
    {
      createSocket: (url, headers) => sdk.websocket.create(url, headers),
      onBroadcast: (event) => {
        if (event === config.events.orderReady) {
          scheduler.requestOrders();
        } else if (event === config.events.tableSyncRequested) {
          scheduler.requestTableSync();
        }
      },
      onConnectionChange: (connected) => scheduler.setRealtimeConnected(connected)
    }
  );
  realtime.start();
}

async function start(): Promise<void> {
  let sdk: PosPluginSdk;
  try {
    ensureWorkerGlobal();
    sdk = (await import("@tossplace/pos-plugin-sdk")).posPluginSdk;
  } catch (error) {
    reportCrash("sdk-import", error);
    return;
  }

  try {
    await configureSettings(sdk);
  } catch (error) {
    reportCrash("configure-settings", error);
  }

  // 실시간 설정을 받기 전까지는 기존처럼 3초 폴링으로 시작한다.
  const scheduler = new SyncScheduler(
    {
      processOrder: () => processOrderStep(sdk),
      processTableSync: () => processTableSyncStep(sdk),
      onError: (error) => {
        reportCrash("poll", error);
        console.error("lam POS plugin: order sync failed", error);
      }
    },
    { connectedMs: DEFAULT_CONNECTED_POLL_MS, disconnectedMs: DISCONNECTED_POLL_MS }
  );
  scheduler.start();

  try {
    await startRealtime(sdk, scheduler);
  } catch (error) {
    reportCrash("realtime-setup", error);
  }
}

void start();
