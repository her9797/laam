import { POSAPIClient, type PluginHTTP } from "./api-client";

function httpWith(
  post: jest.MockedFunction<PluginHTTP["post"]>,
  get: jest.MockedFunction<PluginHTTP["get"]> = jest.fn()
): PluginHTTP {
  return { post, get };
}

it("claims one pending order with the plugin bearer token", async () => {
  const post = jest.fn().mockResolvedValue({
    code: 200,
    headers: [],
    body: JSON.stringify({
      claimToken: "claim-token",
      order: {
        orderId: "order-1",
        tableNumber: "T-01",
        catalogItemId: "42",
        menuItemName: "하우스 하이볼",
        categoryName: "하이볼",
        requestNote: "",
        amount: 10000,
        baseAmount: 10000
      }
    })
  });
  const client = new POSAPIClient(httpWith(post), "https://api.example.com/", "plugin-token");

  await expect(client.claim()).resolves.toMatchObject({ claimToken: "claim-token" });
  expect(post).toHaveBeenCalledWith(
    "https://api.example.com/api/v1/pos-plugin/orders/claim",
    {},
    [["Authorization", "Bearer plugin-token"]],
    { timeoutMs: 10000 }
  );
});

it("returns no work for a 204 claim response", async () => {
  const post = jest.fn().mockResolvedValue({ code: 204, headers: [], body: "" });
  const client = new POSAPIClient(httpWith(post), "https://api.example.com", "plugin-token");

  await expect(client.claim()).resolves.toBeUndefined();
});

it("rejects an unexpected API response without exposing the token", async () => {
  const post = jest.fn().mockResolvedValue({ code: 401, headers: [], body: "unauthorized" });
  const client = new POSAPIClient(httpWith(post), "https://api.example.com", "plugin-token");

  await expect(client.claim()).rejects.toThrow("HTTP 401");
  await expect(client.claim()).rejects.not.toThrow("plugin-token");
});

it("claims one pending table sync request", async () => {
  const post = jest.fn().mockResolvedValue({
    code: 200,
    headers: [],
    body: JSON.stringify({ syncId: "sync-1" })
  });
  const client = new POSAPIClient(httpWith(post), "https://api.example.com", "plugin-token");

  await expect(client.claimTableSync()).resolves.toBe("sync-1");
  expect(post).toHaveBeenCalledWith(
    "https://api.example.com/api/v1/pos-plugin/tables/claim",
    {},
    [["Authorization", "Bearer plugin-token"]],
    { timeoutMs: 10000 }
  );
});

it("returns no table sync work for a 204 claim response", async () => {
  const post = jest.fn().mockResolvedValue({ code: 204, headers: [], body: "" });
  const client = new POSAPIClient(httpWith(post), "https://api.example.com", "plugin-token");

  await expect(client.claimTableSync()).resolves.toBeUndefined();
});

it("uploads the hall and table snapshot in the agreed body shape", async () => {
  const post = jest.fn().mockResolvedValue({ code: 204, headers: [], body: "" });
  const client = new POSAPIClient(httpWith(post), "https://api.example.com", "plugin-token");

  await client.completeTableSync("sync 1", {
    halls: [{ id: 7, name: "1층" }],
    tables: [{ id: 12345, title: "T01", hallId: 7, capacity: 4 }]
  });

  expect(post).toHaveBeenCalledWith(
    "https://api.example.com/api/v1/pos-plugin/tables/sync%201/complete",
    {
      halls: [{ id: 7, name: "1층" }],
      tables: [{ id: 12345, title: "T01", hallId: 7, capacity: 4 }]
    },
    [["Authorization", "Bearer plugin-token"]],
    { timeoutMs: 10000 }
  );
});

it("reports a table sync failure reason", async () => {
  const post = jest.fn().mockResolvedValue({ code: 204, headers: [], body: "" });
  const client = new POSAPIClient(httpWith(post), "https://api.example.com", "plugin-token");

  await client.failTableSync("sync-1", "테이블 목록 조회 실패");

  expect(post).toHaveBeenCalledWith(
    "https://api.example.com/api/v1/pos-plugin/tables/sync-1/fail",
    { error: "테이블 목록 조회 실패" },
    [["Authorization", "Bearer plugin-token"]],
    { timeoutMs: 10000 }
  );
});

it("rejects a failed table sync claim without exposing the token", async () => {
  const post = jest.fn().mockResolvedValue({ code: 401, headers: [], body: "unauthorized" });
  const client = new POSAPIClient(httpWith(post), "https://api.example.com", "plugin-token");

  await expect(client.claimTableSync()).rejects.toThrow("HTTP 401");
  await expect(client.claimTableSync()).rejects.not.toThrow("plugin-token");
});

it("fetches server table mappings over GET", async () => {
  const get = jest.fn().mockResolvedValue({
    code: 200,
    headers: [],
    body: JSON.stringify({ mappings: { "T-01": 12345 }, updatedAt: "2026-09-19T00:00:00Z" })
  });
  const client = new POSAPIClient(httpWith(jest.fn(), get), "https://api.example.com", "plugin-token");

  await expect(client.fetchTableMappings()).resolves.toEqual({ "T-01": 12345 });
  expect(get).toHaveBeenCalledWith(
    "https://api.example.com/api/v1/pos-plugin/table-mappings",
    [["Authorization", "Bearer plugin-token"]],
    { timeoutMs: 10000 }
  );
});

it("drops malformed server table mapping entries", async () => {
  const get = jest.fn().mockResolvedValue({
    code: 200,
    headers: [],
    body: JSON.stringify({ mappings: { "T-01": 12345, "T-02": "abc", "T-03": 0 }, updatedAt: null })
  });
  const client = new POSAPIClient(httpWith(jest.fn(), get), "https://api.example.com", "plugin-token");

  await expect(client.fetchTableMappings()).resolves.toEqual({ "T-01": 12345 });
});

it("rejects a failed table mapping fetch", async () => {
  const get = jest.fn().mockResolvedValue({ code: 500, headers: [], body: "boom" });
  const client = new POSAPIClient(httpWith(jest.fn(), get), "https://api.example.com", "plugin-token");

  await expect(client.fetchTableMappings()).rejects.toThrow("HTTP 500");
});
