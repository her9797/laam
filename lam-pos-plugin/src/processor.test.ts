import type { ClaimedOrder } from "./order-sync";
import { processNextClaim, type ProcessorDependencies } from "./processor";

const claim: ClaimedOrder = {
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
};

function dependencies(overrides: Partial<ProcessorDependencies> = {}): ProcessorDependencies {
  return {
    claim: jest.fn().mockResolvedValue(claim),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    getProcessedPOSOrderID: jest.fn().mockResolvedValue(undefined),
    rememberProcessedPOSOrderID: jest.fn().mockResolvedValue(undefined),
    syncToPOS: jest.fn().mockResolvedValue("pos-order-1"),
    ...overrides
  };
}

it("stores the POS result before completing the API claim", async () => {
  const calls: string[] = [];
  const deps = dependencies({
    rememberProcessedPOSOrderID: jest.fn(async () => {
      calls.push("remember");
    }),
    complete: jest.fn(async () => {
      calls.push("complete");
    })
  });

  await processNextClaim(deps);

  expect(calls).toEqual(["remember", "complete"]);
  expect(deps.complete).toHaveBeenCalledWith("order-1", "claim-token", "pos-order-1");
  expect(deps.fail).not.toHaveBeenCalled();
});

it("reuses a remembered POS order instead of registering the menu twice", async () => {
  const deps = dependencies({
    getProcessedPOSOrderID: jest.fn().mockResolvedValue("existing-pos-order")
  });

  await processNextClaim(deps);

  expect(deps.syncToPOS).not.toHaveBeenCalled();
  expect(deps.complete).toHaveBeenCalledWith("order-1", "claim-token", "existing-pos-order");
});

it("reports a POS registration failure so the API can retry it later", async () => {
  const deps = dependencies({
    syncToPOS: jest.fn().mockRejectedValue(new Error("table missing"))
  });

  await expect(processNextClaim(deps)).rejects.toThrow("table missing");

  expect(deps.fail).toHaveBeenCalledWith("order-1", "claim-token", "table missing");
  expect(deps.complete).not.toHaveBeenCalled();
});
