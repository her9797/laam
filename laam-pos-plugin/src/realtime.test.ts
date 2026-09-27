import { PhoenixRealtimeClient, type RealtimeSocket } from "./realtime";

const URL = "wss://project.supabase.co/realtime/v1/websocket?apikey=anon&vsn=1.0.0";
const TOPIC = "realtime:pos-plugin";

interface Frame {
  topic: string;
  event: string;
  payload: unknown;
  ref: string | null;
}

class FakeSocket implements RealtimeSocket {
  readonly sent: Frame[] = [];
  readonly disconnect = jest.fn(async () => {});
  private messageCallback: ((message: string) => void) | undefined;
  private errorCallback: ((name?: string, message?: string) => void) | undefined;
  private closeCallback: ((code: string) => void) | undefined;

  send = jest.fn((data: { data: string }) => {
    this.sent.push(JSON.parse(data.data) as Frame);
  });

  onMessage(callback: (message: string) => void): void {
    this.messageCallback = callback;
  }

  onError(callback: (name?: string, message?: string) => void): void {
    this.errorCallback = callback;
  }

  onClose(callback: (code: string) => void): void {
    this.closeCallback = callback;
  }

  receive(frame: Frame): void {
    this.messageCallback?.(JSON.stringify(frame));
  }

  replyToJoin(status = "ok"): void {
    this.receive({ topic: TOPIC, event: "phx_reply", payload: { status, response: {} }, ref: "1" });
  }

  replyToHeartbeat(ref: string): void {
    this.receive({ topic: "phoenix", event: "phx_reply", payload: { status: "ok", response: {} }, ref });
  }

  fail(): void {
    this.errorCallback?.("Error", "boom");
  }

  close(code = "1006"): void {
    this.closeCallback?.(code);
  }

  heartbeats(): Frame[] {
    return this.sent.filter((frame) => frame.event === "heartbeat");
  }
}

function setup(options: { random?: () => number } = {}) {
  const sockets: FakeSocket[] = [];
  const createSocket = jest.fn(async (_url: string, _headers: Record<string, string>) => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const onBroadcast = jest.fn();
  const onConnectionChange = jest.fn();
  const client = new PhoenixRealtimeClient(
    { url: URL, apiKey: "anon", topic: TOPIC },
    { createSocket, onBroadcast, onConnectionChange },
    { random: options.random ?? (() => 1) }
  );
  return { client, sockets, createSocket, onBroadcast, onConnectionChange };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("joins the topic right after the socket connects", async () => {
  const { client, sockets, createSocket, onConnectionChange } = setup();

  client.start();
  await jest.advanceTimersByTimeAsync(0);

  expect(createSocket).toHaveBeenCalledWith(URL, { apikey: "anon" });
  expect(sockets[0].sent).toEqual([
    {
      topic: TOPIC,
      event: "phx_join",
      payload: { config: { broadcast: { self: false }, presence: { key: "" }, private: false } },
      ref: "1"
    }
  ]);
  expect(client.isConnected()).toBe(false);

  sockets[0].replyToJoin();

  expect(client.isConnected()).toBe(true);
  expect(onConnectionChange).toHaveBeenCalledWith(true);
});

it("sends a heartbeat every 25 seconds with an increasing ref", async () => {
  const { client, sockets } = setup();
  client.start();
  await jest.advanceTimersByTimeAsync(0);
  sockets[0].replyToJoin();

  await jest.advanceTimersByTimeAsync(24_999);
  expect(sockets[0].heartbeats()).toHaveLength(0);

  await jest.advanceTimersByTimeAsync(1);
  expect(sockets[0].heartbeats()).toEqual([{ topic: "phoenix", event: "heartbeat", payload: {}, ref: "2" }]);
  sockets[0].replyToHeartbeat("2");

  await jest.advanceTimersByTimeAsync(25_000);
  expect(sockets[0].heartbeats().map((frame) => frame.ref)).toEqual(["2", "3"]);
  expect(client.isConnected()).toBe(true);
});

it("dispatches broadcast events on the joined topic", async () => {
  const { client, sockets, onBroadcast } = setup();
  client.start();
  await jest.advanceTimersByTimeAsync(0);
  sockets[0].replyToJoin();

  sockets[0].receive({
    topic: TOPIC,
    event: "broadcast",
    payload: { type: "broadcast", event: "order_ready", payload: { storeId: "s1" } },
    ref: null
  });
  sockets[0].receive({
    topic: "realtime:other",
    event: "broadcast",
    payload: { type: "broadcast", event: "order_ready", payload: {} },
    ref: null
  });
  sockets[0].receive({ topic: TOPIC, event: "presence_state", payload: {}, ref: null });

  expect(onBroadcast).toHaveBeenCalledTimes(1);
  expect(onBroadcast).toHaveBeenCalledWith("order_ready", { storeId: "s1" });
});

it("ignores malformed frames", async () => {
  const { client, sockets, onBroadcast } = setup();
  client.start();
  await jest.advanceTimersByTimeAsync(0);
  sockets[0].replyToJoin();

  (sockets[0] as unknown as { messageCallback: (message: string) => void }).messageCallback("not json");

  expect(onBroadcast).not.toHaveBeenCalled();
  expect(client.isConnected()).toBe(true);
});

it("reconnects when a heartbeat reply is missed", async () => {
  const { client, sockets, onConnectionChange } = setup();
  client.start();
  await jest.advanceTimersByTimeAsync(0);
  sockets[0].replyToJoin();

  await jest.advanceTimersByTimeAsync(25_000);
  expect(sockets[0].heartbeats()).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(25_000);

  expect(client.isConnected()).toBe(false);
  expect(onConnectionChange).toHaveBeenLastCalledWith(false);
  expect(sockets[0].disconnect).toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(1_000);
  expect(sockets).toHaveLength(2);
  sockets[1].replyToJoin();
  expect(client.isConnected()).toBe(true);
});

it("reconnects after the socket closes or errors", async () => {
  const { client, sockets } = setup();
  client.start();
  await jest.advanceTimersByTimeAsync(0);
  sockets[0].replyToJoin();

  sockets[0].close();
  expect(client.isConnected()).toBe(false);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(sockets).toHaveLength(2);

  sockets[1].replyToJoin();
  sockets[1].fail();
  await jest.advanceTimersByTimeAsync(1_000);
  expect(sockets).toHaveLength(3);
});

it("reconnects when the join is rejected or never answered", async () => {
  const { client, sockets } = setup();
  client.start();
  await jest.advanceTimersByTimeAsync(0);

  sockets[0].replyToJoin("error");
  await jest.advanceTimersByTimeAsync(1_000);
  expect(sockets).toHaveLength(2);

  await jest.advanceTimersByTimeAsync(10_000);
  expect(sockets[1].disconnect).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(2_000);
  expect(sockets).toHaveLength(3);
});

it("backs off exponentially up to 60 seconds while connecting fails", async () => {
  const { client, createSocket } = setup();
  createSocket.mockRejectedValue(new Error("offline"));

  client.start();
  await jest.advanceTimersByTimeAsync(0);
  expect(createSocket).toHaveBeenCalledTimes(1);

  const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000];
  for (const [index, delay] of expectedDelays.entries()) {
    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(createSocket).toHaveBeenCalledTimes(index + 1);
    await jest.advanceTimersByTimeAsync(1);
    expect(createSocket).toHaveBeenCalledTimes(index + 2);
  }
});

it("applies jitter to the reconnect delay", async () => {
  const { client, createSocket } = setup({ random: () => 0 });
  createSocket.mockRejectedValue(new Error("offline"));

  client.start();
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(500);
  expect(createSocket).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(createSocket).toHaveBeenCalledTimes(3);
});

it("resets the backoff after a successful join", async () => {
  const { client, sockets, createSocket } = setup();
  createSocket.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));

  client.start();
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(1_000 + 2_000);
  expect(sockets).toHaveLength(1);
  sockets[0].replyToJoin();

  sockets[0].close();
  await jest.advanceTimersByTimeAsync(1_000);
  expect(sockets).toHaveLength(2);
});

it("disconnects the old socket before opening a new one", async () => {
  const { client, sockets, createSocket } = setup();
  const order: string[] = [];
  createSocket.mockImplementation(async () => {
    order.push("create");
    const socket = new FakeSocket();
    socket.disconnect.mockImplementation(async () => {
      order.push("disconnect");
    });
    sockets.push(socket);
    return socket;
  });

  client.start();
  await jest.advanceTimersByTimeAsync(0);
  sockets[0].close();
  await jest.advanceTimersByTimeAsync(1_000);

  expect(order).toEqual(["create", "disconnect", "create"]);
});

it("ignores events from a socket that was replaced", async () => {
  const { client, sockets, onBroadcast } = setup();
  client.start();
  await jest.advanceTimersByTimeAsync(0);
  sockets[0].replyToJoin();
  sockets[0].close();
  await jest.advanceTimersByTimeAsync(1_000);
  sockets[1].replyToJoin();

  sockets[0].close();
  sockets[0].receive({
    topic: TOPIC,
    event: "broadcast",
    payload: { type: "broadcast", event: "order_ready", payload: {} },
    ref: null
  });

  expect(client.isConnected()).toBe(true);
  expect(onBroadcast).not.toHaveBeenCalled();
});

it("stops reconnecting after stop", async () => {
  const { client, sockets, onConnectionChange } = setup();
  client.start();
  await jest.advanceTimersByTimeAsync(0);
  sockets[0].replyToJoin();

  await client.stop();
  await jest.advanceTimersByTimeAsync(120_000);

  expect(sockets).toHaveLength(1);
  expect(sockets[0].disconnect).toHaveBeenCalled();
  expect(client.isConnected()).toBe(false);
  expect(onConnectionChange).toHaveBeenLastCalledWith(false);
});
