import type { ClaimedOrder, TableMappings } from "./order-sync";

interface PluginHTTPResponse {
  body: string;
  headers: [string, string][];
  code: number;
}

export interface PluginHTTP {
  post(
    url: string,
    payload: unknown,
    headers?: [string, string][],
    options?: { timeoutMs?: number }
  ): Promise<PluginHTTPResponse>;
  get(
    url: string,
    headers?: [string, string][],
    options?: { timeoutMs?: number }
  ): Promise<PluginHTTPResponse>;
}

export interface POSHallSnapshot {
  id: number;
  name: string;
}

export interface POSTableSnapshot {
  id: number;
  title: string;
  hallId: number | null;
  capacity: number | null;
}

export interface TableSnapshot {
  halls: POSHallSnapshot[];
  tables: POSTableSnapshot[];
}

export interface OrderClaimResult {
  claim: ClaimedOrder | undefined;
  /**
   * 응답의 `X-Table-Sync-Pending` 헤더. 헤더가 없거나(옛 API) 값을 알 수 없으면
   * undefined이며, 이때는 테이블 claim을 건너뛰지 않는다.
   */
  tableSyncPending: boolean | undefined;
}

export interface RealtimeEvents {
  orderReady: string;
  tableSyncRequested: string;
}

export type RealtimeConfig =
  | {
      enabled: true;
      url: string;
      apiKey: string;
      topic: string;
      events: RealtimeEvents;
      fallbackPollSeconds: number;
    }
  | { enabled: false; fallbackPollSeconds: number };

const DISABLED_FALLBACK_POLL_SECONDS = 3;
const ENABLED_FALLBACK_POLL_SECONDS = 60;

function headerValue(headers: [string, string][] | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  const found = (Array.isArray(headers) ? headers : []).find(
    (header) => Array.isArray(header) && String(header[0]).toLowerCase() === lower
  );
  return found ? String(found[1]).trim() : undefined;
}

function parseTableSyncPending(headers: [string, string][] | undefined): boolean | undefined {
  const value = headerValue(headers, "X-Table-Sync-Pending");
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    return false;
  }
  return undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function pollSeconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : fallback;
}

function parseRealtimeConfig(body: string): RealtimeConfig {
  const raw = JSON.parse(body) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error("실시간 설정 응답 형식이 올바르지 않음");
  }
  if (raw.enabled !== true) {
    return {
      enabled: false,
      fallbackPollSeconds: pollSeconds(raw.fallbackPollSeconds, DISABLED_FALLBACK_POLL_SECONDS)
    };
  }

  const events = (raw.events ?? {}) as Record<string, unknown>;
  const url = raw.url;
  if (!nonEmptyString(url) || !/^wss?:\/\//.test(url)) {
    throw new Error("실시간 설정의 websocket 주소가 올바르지 않음");
  }
  if (
    !nonEmptyString(raw.apiKey) ||
    !nonEmptyString(raw.topic) ||
    !nonEmptyString(events.orderReady) ||
    !nonEmptyString(events.tableSyncRequested)
  ) {
    throw new Error("실시간 설정 응답 형식이 올바르지 않음");
  }
  return {
    enabled: true,
    url,
    apiKey: raw.apiKey,
    topic: raw.topic,
    events: { orderReady: events.orderReady, tableSyncRequested: events.tableSyncRequested },
    fallbackPollSeconds: pollSeconds(raw.fallbackPollSeconds, ENABLED_FALLBACK_POLL_SECONDS)
  };
}

export class POSAPIClient {
  private readonly baseURL: string;
  private readonly headers: [string, string][];

  constructor(private readonly http: PluginHTTP, baseURL: string, token: string) {
    this.baseURL = baseURL.trim().replace(/\/+$/, "");
    this.headers = [["Authorization", `Bearer ${token.trim()}`]];
    if (!this.baseURL.startsWith("https://") && !this.baseURL.startsWith("http://")) {
      throw new Error("API 주소는 http:// 또는 https://로 시작해야 함");
    }
    if (!token.trim()) {
      throw new Error("POS 플러그인 API 토큰이 비어 있음");
    }
  }

  async claim(): Promise<OrderClaimResult> {
    const response = await this.http.post(
      `${this.baseURL}/api/v1/pos-plugin/orders/claim`,
      {},
      this.headers,
      { timeoutMs: 10000 }
    );
    const tableSyncPending = parseTableSyncPending(response.headers);
    if (response.code === 204) {
      return { claim: undefined, tableSyncPending };
    }
    this.requireSuccess(response);
    const claim = JSON.parse(response.body) as ClaimedOrder;
    if (!claim.claimToken || !claim.order?.orderId) {
      throw new Error("POS 주문 claim 응답 형식이 올바르지 않음");
    }
    return { claim, tableSyncPending };
  }

  async complete(orderID: string, claimToken: string, posOrderID: string): Promise<void> {
    const response = await this.http.post(
      `${this.baseURL}/api/v1/pos-plugin/orders/${encodeURIComponent(orderID)}/complete`,
      { claimToken, posOrderId: posOrderID },
      this.headers,
      { timeoutMs: 10000 }
    );
    this.requireSuccess(response);
  }

  async fail(orderID: string, claimToken: string, message: string): Promise<void> {
    const response = await this.http.post(
      `${this.baseURL}/api/v1/pos-plugin/orders/${encodeURIComponent(orderID)}/fail`,
      { claimToken, error: message },
      this.headers,
      { timeoutMs: 10000 }
    );
    this.requireSuccess(response);
  }

  async claimTableSync(): Promise<string | undefined> {
    const response = await this.http.post(
      `${this.baseURL}/api/v1/pos-plugin/tables/claim`,
      {},
      this.headers,
      { timeoutMs: 10000 }
    );
    if (response.code === 204) {
      return undefined;
    }
    this.requireSuccess(response);
    const claim = JSON.parse(response.body) as { syncId?: unknown };
    if (typeof claim.syncId !== "string" || !claim.syncId) {
      throw new Error("POS 테이블 동기화 claim 응답 형식이 올바르지 않음");
    }
    return claim.syncId;
  }

  async completeTableSync(syncID: string, snapshot: TableSnapshot): Promise<void> {
    const response = await this.http.post(
      `${this.baseURL}/api/v1/pos-plugin/tables/${encodeURIComponent(syncID)}/complete`,
      { halls: snapshot.halls, tables: snapshot.tables },
      this.headers,
      { timeoutMs: 10000 }
    );
    this.requireSuccess(response);
  }

  async failTableSync(syncID: string, message: string): Promise<void> {
    const response = await this.http.post(
      `${this.baseURL}/api/v1/pos-plugin/tables/${encodeURIComponent(syncID)}/fail`,
      { error: message },
      this.headers,
      { timeoutMs: 10000 }
    );
    this.requireSuccess(response);
  }

  async fetchTableMappings(): Promise<TableMappings> {
    const response = await this.http.get(
      `${this.baseURL}/api/v1/pos-plugin/table-mappings`,
      this.headers,
      { timeoutMs: 10000 }
    );
    this.requireSuccess(response);
    const payload = JSON.parse(response.body) as { mappings?: unknown };
    const raw = payload.mappings;
    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      throw new Error("POS 테이블 매핑 응답 형식이 올바르지 않음");
    }

    // 서버 항목 하나가 깨져도 나머지 매핑은 살린다.
    const mappings: TableMappings = {};
    for (const [qrTableID, posTableID] of Object.entries(raw)) {
      if (Number.isSafeInteger(posTableID) && Number(posTableID) > 0) {
        mappings[qrTableID] = Number(posTableID);
      }
    }
    return mappings;
  }

  async fetchRealtimeConfig(): Promise<RealtimeConfig> {
    const response = await this.http.get(
      `${this.baseURL}/api/v1/pos-plugin/realtime-config`,
      this.headers,
      { timeoutMs: 10000 }
    );
    this.requireSuccess(response);
    return parseRealtimeConfig(response.body);
  }

  private requireSuccess(response: PluginHTTPResponse): void {
    if (response.code < 200 || response.code >= 300) {
      throw new Error(`laam-api 요청 실패: HTTP ${response.code}`);
    }
  }
}

/**
 * 실시간 설정을 읽는다. 라우트가 없는 옛 API(404)나 네트워크 오류, 잘못된 응답이면
 * 실시간 신호 없이 3초 폴링으로 동작하도록 비활성 설정을 돌려준다.
 */
export async function loadRealtimeConfig(
  client: Pick<POSAPIClient, "fetchRealtimeConfig">
): Promise<RealtimeConfig> {
  try {
    return await client.fetchRealtimeConfig();
  } catch (error) {
    console.warn("lam POS plugin: realtime config unavailable, polling every 3s", error);
    return { enabled: false, fallbackPollSeconds: DISABLED_FALLBACK_POLL_SECONDS };
  }
}
