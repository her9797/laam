import type { ClaimedOrder } from "./order-sync";

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

  private requireSuccess(response: PluginHTTPResponse): void {
    if (response.code < 200 || response.code >= 300) {
      throw new Error(`laam-api 요청 실패: HTTP ${response.code}`);
    }
  }
}
