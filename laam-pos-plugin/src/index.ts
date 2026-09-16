import type { PosPluginSdk } from "@tossplace/pos-plugin-sdk";

import { POSAPIClient } from "./api-client";
import { syncClaim, type TableMappings } from "./order-sync";
import { processNextClaim } from "./processor";
import { ensureWorkerGlobal } from "./runtime-global";

const POLL_INTERVAL_MS = 3_000;
const processedKey = (orderID: string) => `lam:processed-order:${orderID}`;

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
      label: "테이블 매핑 JSON (선택)",
      required: false,
      default: "{}",
      placeholder: "{\"T-01\": 12345}"
    }
  ]);
}

async function runOnce(sdk: PosPluginSdk): Promise<void> {
  const settings = await sdk.setting.getValues<PluginSettings>();
  const baseURL = settings.apiBaseUrl?.trim() ?? "";
  const token = settings.apiToken?.trim() ?? "";
  if (!baseURL || !token) {
    return;
  }

  const mappings = parseTableMappings(settings.tableMappings);
  const api = new POSAPIClient(sdk.http, baseURL, token);
  await processNextClaim({
    claim: () => api.claim(),
    complete: (orderID, claimToken, posOrderID) => api.complete(orderID, claimToken, posOrderID),
    fail: (orderID, claimToken, message) => api.fail(orderID, claimToken, message),
    getProcessedPOSOrderID: (orderID) => sdk.secureStore.get(processedKey(orderID)),
    rememberProcessedPOSOrderID: (orderID, posOrderID) =>
      sdk.secureStore.set(processedKey(orderID), posOrderID),
    syncToPOS: (claim) =>
      syncClaim(
        {
          getTables: () => sdk.table.getTables(),
          getCatalog: (id) => sdk.catalog.getCatalog(id),
          add: (order) => sdk.order.add(order),
          addMenu: (orderID, order) => sdk.order.addMenu(orderID, order)
        },
        claim,
        mappings
      )
  });
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

  const poll = async (): Promise<void> => {
    try {
      await runOnce(sdk);
    } catch (error) {
      reportCrash("poll", error);
      console.error("lam POS plugin: order sync failed", error);
    } finally {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };
  await poll();
}

void start();
