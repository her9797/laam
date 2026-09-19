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

  async claim(): Promise<ClaimedOrder | undefined> {
    const response = await this.http.post(
      `${this.baseURL}/api/v1/pos-plugin/orders/claim`,
      {},
      this.headers,
      { timeoutMs: 10000 }
    );
    if (response.code === 204) {
      return undefined;
    }
    this.requireSuccess(response);
    const claim = JSON.parse(response.body) as ClaimedOrder;
    if (!claim.claimToken || !claim.order?.orderId) {
      throw new Error("POS 주문 claim 응답 형식이 올바르지 않음");
    }
    return claim;
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

  private requireSuccess(response: PluginHTTPResponse): void {
    if (response.code < 200 || response.code >= 300) {
      throw new Error(`laam-api 요청 실패: HTTP ${response.code}`);
    }
  }
}
