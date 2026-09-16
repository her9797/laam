import { POSAPIClient, type PluginHTTP } from "./api-client";

function httpWith(post: jest.MockedFunction<PluginHTTP["post"]>): PluginHTTP {
  return { post };
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
