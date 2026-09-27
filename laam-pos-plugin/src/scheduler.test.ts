import { SyncScheduler, type OrderStepResult, type SchedulerDependencies } from "./scheduler";

const nothingPending: OrderStepResult = { processed: false, tableSyncPending: false };
const processedOne: OrderStepResult = { processed: true, tableSyncPending: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const dependencies = {
    processOrder: jest.fn<Promise<OrderStepResult>, []>().mockResolvedValue(nothingPending),
    processTableSync: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    onError: jest.fn<void, [unknown]>()
  } satisfies SchedulerDependencies;
  const scheduler = new SyncScheduler(dependencies, { connectedMs: 60_000, disconnectedMs: 3_000 });
  return { scheduler, ...dependencies };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it("drains orders until no claim is returned and checks tables when the header is unknown", async () => {
  const { scheduler, processOrder, processTableSync } = setup();
  processOrder
    .mockResolvedValueOnce(processedOne)
    .mockResolvedValueOnce(processedOne)
    .mockResolvedValueOnce({ processed: false, tableSyncPending: undefined });

  scheduler.start();
  await jest.advanceTimersByTimeAsync(0);

  expect(processOrder).toHaveBeenCalledTimes(3);
  expect(processTableSync).toHaveBeenCalledTimes(1);
  scheduler.stop();
});

it("skips the table claim on a poll when the last claim says nothing is pending", async () => {
  const { scheduler, processOrder, processTableSync } = setup();

  scheduler.start();
  await jest.advanceTimersByTimeAsync(0);

  expect(processOrder).toHaveBeenCalledTimes(1);
  expect(processTableSync).not.toHaveBeenCalled();
  scheduler.stop();
});

it("claims a table sync when the last order claim says one is pending", async () => {
  const { scheduler, processOrder, processTableSync } = setup();
  processOrder.mockResolvedValueOnce({ processed: false, tableSyncPending: true });

  scheduler.requestOrders();
  await jest.advanceTimersByTimeAsync(0);

  expect(processTableSync).toHaveBeenCalledTimes(1);
});

it("does not claim tables for an order signal when the header is unknown", async () => {
  const { scheduler, processOrder, processTableSync } = setup();
  processOrder.mockResolvedValueOnce({ processed: false, tableSyncPending: undefined });

  scheduler.requestOrders();
  await jest.advanceTimersByTimeAsync(0);

  expect(processTableSync).not.toHaveBeenCalled();
});

it("coalesces order signals that arrive mid-run into one more drain without running concurrently", async () => {
  const first = deferred<OrderStepResult>();
  let active = 0;
  let maxActive = 0;
  const { scheduler, processOrder } = setup();
  processOrder.mockImplementation(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    const result = processOrder.mock.calls.length === 1 ? await first.promise : nothingPending;
    active--;
    return result;
  });

  scheduler.requestOrders();
  await jest.advanceTimersByTimeAsync(0);
  scheduler.requestOrders();
  scheduler.requestOrders();
  scheduler.requestOrders();
  await jest.advanceTimersByTimeAsync(0);
  expect(processOrder).toHaveBeenCalledTimes(1);

  first.resolve(nothingPending);
  await jest.advanceTimersByTimeAsync(0);

  expect(processOrder).toHaveBeenCalledTimes(2);
  expect(maxActive).toBe(1);
});

it("runs table sync once for signals received during an order run", async () => {
  const first = deferred<OrderStepResult>();
  const { scheduler, processOrder, processTableSync } = setup();
  processOrder.mockReturnValueOnce(first.promise);

  scheduler.requestOrders();
  await jest.advanceTimersByTimeAsync(0);
  scheduler.requestTableSync();
  scheduler.requestTableSync();
  await jest.advanceTimersByTimeAsync(0);
  expect(processTableSync).not.toHaveBeenCalled();

  first.resolve(nothingPending);
  await jest.advanceTimersByTimeAsync(0);

  expect(processTableSync).toHaveBeenCalledTimes(1);
  expect(processOrder).toHaveBeenCalledTimes(1);
});

it("runs a table sync signal without claiming orders", async () => {
  const { scheduler, processOrder, processTableSync } = setup();

  scheduler.requestTableSync();
  await jest.advanceTimersByTimeAsync(0);

  expect(processTableSync).toHaveBeenCalledTimes(1);
  expect(processOrder).not.toHaveBeenCalled();
});

it("polls every 3s while disconnected and every 60s while realtime is connected", async () => {
  const { scheduler, processOrder } = setup();

  scheduler.start();
  await jest.advanceTimersByTimeAsync(0);
  expect(processOrder).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(3_000);
  expect(processOrder).toHaveBeenCalledTimes(2);

  // 연결 직후 한 번 전체 drain해 끊긴 동안의 신호를 놓치지 않는다.
  scheduler.setRealtimeConnected(true);
  await jest.advanceTimersByTimeAsync(0);
  expect(processOrder).toHaveBeenCalledTimes(3);

  await jest.advanceTimersByTimeAsync(59_999);
  expect(processOrder).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(1);
  expect(processOrder).toHaveBeenCalledTimes(4);

  scheduler.setRealtimeConnected(false);
  await jest.advanceTimersByTimeAsync(3_000);
  expect(processOrder).toHaveBeenCalledTimes(5);
  await jest.advanceTimersByTimeAsync(3_000);
  expect(processOrder).toHaveBeenCalledTimes(6);
  scheduler.stop();
});

it("drains again after every reconnect", async () => {
  const { scheduler, processOrder } = setup();
  scheduler.start();
  await jest.advanceTimersByTimeAsync(0);

  scheduler.setRealtimeConnected(true);
  await jest.advanceTimersByTimeAsync(0);
  scheduler.setRealtimeConnected(false);
  scheduler.setRealtimeConnected(true);
  await jest.advanceTimersByTimeAsync(0);

  expect(processOrder).toHaveBeenCalledTimes(3);
  scheduler.stop();
});

it("uses the configured interval when realtime is disabled", async () => {
  const { scheduler, processOrder } = setup();
  scheduler.setPollIntervals({ connectedMs: 60_000, disconnectedMs: 5_000 });

  scheduler.start();
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(4_999);
  expect(processOrder).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(processOrder).toHaveBeenCalledTimes(2);
  scheduler.stop();
});

it("reports an order failure and retries soon even while connected", async () => {
  const error = new Error("POS 등록 실패");
  const { scheduler, processOrder, processTableSync, onError } = setup();
  scheduler.start();
  await jest.advanceTimersByTimeAsync(0);
  scheduler.setRealtimeConnected(true);
  await jest.advanceTimersByTimeAsync(0);
  expect(processOrder).toHaveBeenCalledTimes(2);

  processOrder.mockRejectedValueOnce(error);
  scheduler.requestOrders();
  await jest.advanceTimersByTimeAsync(0);
  expect(onError).toHaveBeenCalledWith(error);

  // 재시도 폴링은 헤더를 모르면 테이블 claim까지 확인한다.
  processOrder.mockResolvedValueOnce({ processed: false, tableSyncPending: undefined });
  await jest.advanceTimersByTimeAsync(3_000);
  expect(processOrder).toHaveBeenCalledTimes(4);
  expect(processTableSync).toHaveBeenCalledTimes(1);

  // 재시도가 성공하면 다시 60초 주기로 돌아간다.
  await jest.advanceTimersByTimeAsync(3_000);
  expect(processOrder).toHaveBeenCalledTimes(4);
  scheduler.stop();
});

it("stops polling after stop", async () => {
  const { scheduler, processOrder } = setup();
  scheduler.start();
  await jest.advanceTimersByTimeAsync(0);

  scheduler.stop();
  await jest.advanceTimersByTimeAsync(60_000);

  expect(processOrder).toHaveBeenCalledTimes(1);
});
