/**
 * Supabase Realtime(Phoenix 프로토콜 vsn 1.0.0) broadcast 구독 클라이언트.
 *
 * 토스 SDK의 `websocket.create()`는 내부에서 `connect()`까지 끝낸 뒤 반환하고,
 * 그 사이에 온 open 이벤트는 콜백 등록 전이라 전달되지 않는다. 그래서 create가
 * 성공하면 곧바로 열린 것으로 보고 join을 보낸다.
 */
export interface RealtimeSocket {
  send(data: { data: string }): void;
  disconnect(): Promise<void>;
  onMessage(callback: (message: string) => void): void;
  onError(callback: (errorName?: string, errorMessage?: string) => void): void;
  onClose(callback: (code: string) => void): void;
}

export interface RealtimeEndpoint {
  url: string;
  apiKey: string;
  topic: string;
}

export interface RealtimeDependencies {
  /** 연결이 끝난 socket을 돌려준다. 실패하면 reject한다. */
  createSocket(url: string, headers: Record<string, string>): Promise<RealtimeSocket>;
  onBroadcast(event: string, payload: unknown): void;
  onConnectionChange(connected: boolean): void;
}

export interface RealtimeOptions {
  heartbeatIntervalMs?: number;
  joinTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** 0 이상 1 미만. 재연결 지연에 지터를 준다. */
  random?: () => number;
}

interface PhoenixFrame {
  topic?: unknown;
  event?: unknown;
  payload?: unknown;
  ref?: unknown;
}

const JOIN_REF = "1";
const HEARTBEAT_TOPIC = "phoenix";
const MAX_BACKOFF_EXPONENT = 16;

export class PhoenixRealtimeClient {
  private readonly heartbeatIntervalMs: number;
  private readonly joinTimeoutMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly random: () => number;

  private running = false;
  private joined = false;
  // 교체되거나 정리된 socket의 늦은 콜백을 무시하기 위한 세대 번호.
  private generation = 0;
  private socket: RealtimeSocket | undefined;
  private closing: Promise<void> = Promise.resolve();
  private attempt = 0;
  private nextRef = 2;
  private pendingHeartbeatRef: string | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private joinTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly endpoint: RealtimeEndpoint,
    private readonly dependencies: RealtimeDependencies,
    options: RealtimeOptions = {}
  ) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25_000;
    this.joinTimeoutMs = options.joinTimeoutMs ?? 10_000;
    this.initialBackoffMs = options.initialBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.random = options.random ?? Math.random;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.teardown();
    await this.closing;
  }

  isConnected(): boolean {
    return this.joined;
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    // SDK는 URL로 socket을 구분하므로 이전 socket을 완전히 끊은 뒤에 새로 연다.
    await this.closing;
    if (!this.isCurrent(generation)) {
      return;
    }

    let socket: RealtimeSocket;
    try {
      socket = await this.dependencies.createSocket(this.endpoint.url, { apikey: this.endpoint.apiKey });
    } catch (error) {
      if (this.isCurrent(generation)) {
        console.warn("lam POS plugin: realtime connect failed", errorText(error));
        this.scheduleReconnect();
      }
      return;
    }
    if (!this.isCurrent(generation)) {
      void safeDisconnect(socket);
      return;
    }

    this.socket = socket;
    this.nextRef = 2;
    this.pendingHeartbeatRef = undefined;
    socket.onMessage((message) => {
      if (generation === this.generation) {
        this.handleMessage(generation, message);
      }
    });
    socket.onError((errorName, errorMessage) =>
      this.handleFailure(generation, `error ${errorName ?? ""} ${errorMessage ?? ""}`.trim())
    );
    socket.onClose((code) => this.handleFailure(generation, `closed ${code}`));

    this.joinTimer = setTimeout(() => this.handleFailure(generation, "join timeout"), this.joinTimeoutMs);
    this.send(generation, {
      topic: this.endpoint.topic,
      event: "phx_join",
      payload: { config: { broadcast: { self: false }, presence: { key: "" }, private: false } },
      ref: JOIN_REF
    });
  }

  private handleMessage(generation: number, message: string): void {
    let frame: PhoenixFrame;
    try {
      frame = JSON.parse(message) as PhoenixFrame;
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") {
      return;
    }

    if (frame.event === "phx_reply") {
      const status = (frame.payload as { status?: unknown } | null)?.status;
      if (frame.topic === this.endpoint.topic && frame.ref === JOIN_REF) {
        if (status === "ok") {
          this.handleJoined(generation);
        } else {
          this.handleFailure(generation, `join rejected ${String(status)}`);
        }
      } else if (frame.topic === HEARTBEAT_TOPIC && frame.ref === this.pendingHeartbeatRef) {
        this.pendingHeartbeatRef = undefined;
      }
      return;
    }

    if (frame.topic !== this.endpoint.topic) {
      return;
    }
    if (frame.event === "phx_close" || frame.event === "phx_error") {
      this.handleFailure(generation, String(frame.event));
      return;
    }
    if (frame.event === "broadcast") {
      const broadcast = frame.payload as { event?: unknown; payload?: unknown } | null;
      if (broadcast && typeof broadcast.event === "string") {
        try {
          this.dependencies.onBroadcast(broadcast.event, broadcast.payload);
        } catch (error) {
          console.error("lam POS plugin: realtime broadcast handler failed", error);
        }
      }
    }
  }

  private handleJoined(generation: number): void {
    if (this.joined) {
      return;
    }
    this.clearJoinTimer();
    this.joined = true;
    this.attempt = 0;
    this.heartbeatTimer = setInterval(() => this.heartbeat(generation), this.heartbeatIntervalMs);
    this.dependencies.onConnectionChange(true);
  }

  private heartbeat(generation: number): void {
    if (this.pendingHeartbeatRef !== undefined) {
      this.handleFailure(generation, "heartbeat timeout");
      return;
    }
    const ref = String(this.nextRef++);
    this.pendingHeartbeatRef = ref;
    this.send(generation, { topic: HEARTBEAT_TOPIC, event: "heartbeat", payload: {}, ref });
  }

  private send(generation: number, frame: Record<string, unknown>): void {
    try {
      this.socket?.send({ data: JSON.stringify(frame) });
    } catch (error) {
      this.handleFailure(generation, `send failed ${errorText(error)}`);
    }
  }

  private handleFailure(generation: number, reason: string): void {
    if (!this.isCurrent(generation)) {
      return;
    }
    console.warn("lam POS plugin: realtime connection lost", reason);
    this.teardown();
    this.scheduleReconnect();
  }

  private teardown(): void {
    this.generation++;
    this.clearJoinTimer();
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.pendingHeartbeatRef = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      this.closing = safeDisconnect(socket);
    }
    if (this.joined) {
      this.joined = false;
      this.dependencies.onConnectionChange(false);
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer !== undefined) {
      return;
    }
    const exponent = Math.min(this.attempt, MAX_BACKOFF_EXPONENT);
    this.attempt++;
    const base = Math.min(this.maxBackoffMs, this.initialBackoffMs * 2 ** exponent);
    const delay = Math.round(base * (0.5 + 0.5 * this.random()));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private clearJoinTimer(): void {
    if (this.joinTimer !== undefined) {
      clearTimeout(this.joinTimer);
      this.joinTimer = undefined;
    }
  }

  private isCurrent(generation: number): boolean {
    return this.running && generation === this.generation;
  }
}

async function safeDisconnect(socket: RealtimeSocket): Promise<void> {
  try {
    await socket.disconnect();
  } catch {
    // 이미 끊긴 socket이면 무시한다.
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
