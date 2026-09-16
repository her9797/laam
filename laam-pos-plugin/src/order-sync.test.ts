import type { PluginCatalogItem, PluginOrder, PluginOrderDto, PluginTable } from "@tossplace/pos-plugin-sdk";

import { resolveTable, syncClaim, type ClaimedOrder, type POSDependencies } from "./order-sync";

const catalog = {
  id: 42,
  title: "하우스 하이볼",
  code: "HB-01",
  category: { id: 3, title: "하이볼" },
  price: { value: 10000 },
  options: [
    {
      id: 7,
      title: "샷",
      isRequired: false,
      minChoices: 0,
      maxChoices: 1,
      defaultChoices: [],
      choices: [{ id: 9, title: "샷 추가", priceValue: 500, state: "ON_SALE", quantityInputEnabled: false }]
    }
  ]
} as unknown as PluginCatalogItem;

const claim: ClaimedOrder = {
  claimToken: "claim-token",
  order: {
    orderId: "order-1",
    tableNumber: "T-01",
    catalogItemId: "42",
    menuItemName: "하우스 하이볼",
    categoryName: "하이볼",
    requestNote: "얼음 적게",
    amount: 10500,
    baseAmount: 10000,
    optionChoices: [{ optionId: "7", optionChoiceId: "9", quantity: 1 }]
  }
};

function table(id: number, title: string, order?: PluginOrder): PluginTable & { order?: PluginOrder } {
  return { id, hallId: 1, title, order };
}

function dependencies(tables: (PluginTable & { order?: PluginOrder })[]): {
  deps: POSDependencies;
  add: jest.Mock<Promise<PluginOrder>, [PluginOrderDto]>;
  addMenu: jest.Mock<Promise<PluginOrder>, [string, PluginOrderDto]>;
} {
  const result = { id: "pos-order-1" } as PluginOrder;
  const add = jest.fn<Promise<PluginOrder>, [PluginOrderDto]>().mockResolvedValue(result);
  const addMenu = jest.fn<Promise<PluginOrder>, [string, PluginOrderDto]>().mockResolvedValue(result);
  return {
    deps: {
      getTables: async () => tables,
      getCatalog: async () => catalog,
      add,
      addMenu
    },
    add,
    addMenu
  };
}

describe("resolveTable", () => {
  it("matches QR table names after removing separators", () => {
    expect(resolveTable([table(11, "T01")], "T-01", {})).toMatchObject({ id: 11 });
  });

  it("matches a numbered QR table to the Korean POS table title", () => {
    expect(resolveTable([table(11, "테이블 01")], "T-01", {})).toMatchObject({ id: 11 });
  });

  it("matches a numbered QR bar seat to the Korean POS bar title", () => {
    expect(resolveTable([table(23, "바 자리 03")], "B-03", {})).toMatchObject({ id: 23 });
  });

  it("uses an explicit table id mapping before title matching", () => {
    expect(resolveTable([table(11, "홀 1")], "T-01", { "T-01": 11 })).toMatchObject({ id: 11 });
  });
});

describe("syncClaim", () => {
  it("adds a new table order with the Toss catalog item and selected options", async () => {
    const { deps, add, addMenu } = dependencies([table(11, "T01")]);

    const posOrderId = await syncClaim(deps, claim, {});

    expect(posOrderId).toBe("pos-order-1");
    expect(addMenu).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith({
      orderKey: "order-1",
      tableId: 11,
      memo: "얼음 적게",
      discounts: [],
      lineItems: [
        {
          diningOption: "HERE",
          item: { id: 42, title: "하우스 하이볼", code: "HB-01", category: catalog.category, type: "ITEM" },
          quantity: { value: 1 },
          chargePrice: { value: 10000 },
          optionChoices: [{ id: 9, quantity: 1 }],
          discounts: [],
          memo: "얼음 적게"
        }
      ]
    });
  });

  it("adds only the new menu when the table already has an open order", async () => {
    const currentOrder = { id: "existing-order" } as PluginOrder;
    const { deps, add, addMenu } = dependencies([table(11, "T01", currentOrder)]);

    await syncClaim(deps, claim, {});

    expect(add).not.toHaveBeenCalled();
    expect(addMenu).toHaveBeenCalledWith("existing-order", expect.objectContaining({ tableId: 11 }));
  });
});
