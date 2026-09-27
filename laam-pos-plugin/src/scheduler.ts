export interface OrderStepResult {
  /** 주문 한 건을 claim해 처리했으면 true, 대기 주문이 없으면 false. */
  processed: boolean;
  /** 마지막 claim 응답의 `X-Table-Sync-Pending`. 알 수 없으면 undefined. */
  tableSyncPending: boolean | undefined;
}

export interface SchedulerDependencies {
  processOrder(): Promise<OrderStepResult>;
  /** 예외를 던지지 않는 테이블 동기화 한 번. */
  processTableSync(): Promise<void>;
  onError(error: unknown): void;
}

export interface PollIntervals {
  /** 실시간 신호가 연결돼 있을 때의 예비 폴링 주기. */
  connectedMs: number;
  /** 실시간이 끊겼거나 꺼져 있을 때의 폴링 주기. 실패 직후 재시도에도 쓴다. */
  disconnectedMs: number;
}

const MAX_ORDERS_PER_DRAIN = 50;

/**
 * 주문·테이블 처리를 한 번에 하나만 실행하는 스케줄러.
 *
 * - 실시간 신호(`requestOrders`, `requestTableSync`)는 실행 중이면 다음 한 번으로 합친다.
 * - 예비 폴링은 주문을 비울 때까지 claim하고, 마지막 claim이 테이블 요청 대기를
 *   알리거나 알 수 없을 때만 테이블 claim을 호출한다.
 */
export class SyncScheduler {
  private started = false;
  private running = false;
  private connected = false;
  private ordersRequested = false;
  private tablesRequested = false;
  private pollRequested = false;
  private tableSyncPending: boolean | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly dependencies: SchedulerDependencies,
    private intervals: PollIntervals
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.requestPoll();
    this.arm(this.currentInterval());
  }

  stop(): void {
    this.started = false;
    this.clearTimer();
  }

  requestOrders(): void {
    this.ordersRequested = true;
    this.kick();
  }

  requestTableSync(): void {
    this.tablesRequested = true;
    this.kick();
  }

  setRealtimeConnected(connected: boolean): void {
    if (this.connected === connected) {
      return;
    }
    this.connected = connected;
    if (!this.started) {
      return;
    }
    this.arm(this.currentInterval());
    if (connected) {
      // 끊긴 동안 놓친 신호가 있을 수 있으므로 연결 직후 한 번 전체를 비운다.
      this.requestPoll();
    }
  }

  setPollIntervals(intervals: PollIntervals): void {
    this.intervals = intervals;
    if (this.started) {
      this.arm(this.currentInterval());
    }
  }

  private requestPoll(): void {
    this.pollRequested = true;
    this.kick();
  }

  private kick(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    let failed = false;
    try {
      while (this.ordersRequested || this.tablesRequested || this.pollRequested) {
        const poll = this.pollRequested;
        const orders = this.ordersRequested || poll;
        this.pollRequested = false;
        this.ordersRequested = false;

        if (orders && !(await this.drainOrders())) {
          failed = true;
        }

        const tables =
          this.tablesRequested ||
          this.tableSyncPending === true ||
          (poll && this.tableSyncPending === undefined);
        this.tablesRequested = false;
        if (tables) {
          await this.runTableSync();
        }
      }
    } finally {
      this.running = false;
    }

    if (failed && this.started) {
      // 실패한 뒤에는 실시간 연결 여부와 관계없이 짧은 주기로 한 번 다시 시도한다.
      this.arm(this.intervals.disconnectedMs);
    }
  }

  private async drainOrders(): Promise<boolean> {
    for (let count = 0; count < MAX_ORDERS_PER_DRAIN; count++) {
      let result: OrderStepResult;
      try {
        result = await this.dependencies.processOrder();
      } catch (error) {
        this.tableSyncPending = undefined;
        this.dependencies.onError(error);
        return false;
      }
      this.tableSyncPending = result.tableSyncPending;
      if (!result.processed) {
        return true;
      }
    }
    // 남은 주문은 다음 신호나 예비 폴링에서 이어서 처리한다.
    return true;
  }

  private async runTableSync(): Promise<void> {
    try {
      await this.dependencies.processTableSync();
    } catch (error) {
      this.dependencies.onError(error);
    }
    // 다음 주문 claim 응답 헤더가 다시 알려 줄 때까지 대기 요청이 없다고 본다.
    this.tableSyncPending = false;
  }

  private arm(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.started) {
        return;
      }
      this.arm(this.currentInterval());
      this.requestPoll();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private currentInterval(): number {
    return this.connected ? this.intervals.connectedMs : this.intervals.disconnectedMs;
  }
}
