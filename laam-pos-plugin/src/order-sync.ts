import type { PluginCatalogItem, PluginOrder, PluginOrderDto, PluginTable } from "@tossplace/pos-plugin-sdk";

export interface ClaimedOrder {
  claimToken: string;
  order: {
    orderId: string;
    tableNumber: string;
    catalogItemId: string;
    menuItemName: string;
    categoryName: string;
    requestNote: string;
    amount: number;
    baseAmount: number;
    optionChoices?: Array<{
      optionId: string;
      optionChoiceId: string;
      quantity: number;
    }>;
  };
}

export interface POSDependencies {
  getTables(): Promise<Array<PluginTable & { order?: PluginOrder }>>;
  getCatalog(id: number): Promise<PluginCatalogItem>;
  add(order: PluginOrderDto): Promise<PluginOrder>;
  addMenu(orderId: string, order: PluginOrderDto): Promise<PluginOrder>;
}

export type TableMappings = Record<string, number>;

function normalizedTableName(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/[\s_-]+/g, "");
}

function semanticTableName(value: string): string | undefined {
  const normalized = normalizedTableName(value);
  const qrMatch = normalized.match(/^([tb])0*(\d+)$/);
  if (qrMatch) {
    return `${qrMatch[1]}:${Number(qrMatch[2])}`;
  }

  const tableMatch = normalized.match(/^테이블0*(\d+)$/);
  if (tableMatch) {
    return `t:${Number(tableMatch[1])}`;
  }

  const barMatch = normalized.match(/^바(?:자리)?0*(\d+)$/);
  if (barMatch) {
    return `b:${Number(barMatch[1])}`;
  }
  return undefined;
}

export function resolveTable(
  tables: Array<PluginTable & { order?: PluginOrder }>,
  tableNumber: string,
  mappings: TableMappings
): (PluginTable & { order?: PluginOrder }) | undefined {
  const normalizedNumber = normalizedTableName(tableNumber);
  const explicitEntry = Object.entries(mappings).find(
    ([key]) => key === tableNumber || normalizedTableName(key) === normalizedNumber
  );
  if (explicitEntry) {
    return tables.find((candidate) => candidate.id === explicitEntry[1]);
  }

  const exactMatches = tables.filter((candidate) => normalizedTableName(candidate.title) === normalizedNumber);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const semanticNumber = semanticTableName(tableNumber);
  if (!semanticNumber) {
    return undefined;
  }
  const semanticMatches = tables.filter((candidate) => semanticTableName(candidate.title) === semanticNumber);
  return semanticMatches.length === 1 ? semanticMatches[0] : undefined;
}

function catalogID(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`유효하지 않은 토스 카탈로그 상품 ID: ${value}`);
  }
  return id;
}

function selectedOptions(catalog: PluginCatalogItem, claim: ClaimedOrder): Array<{ id: number; quantity: number }> {
  return (claim.order.optionChoices ?? []).map((selected) => {
    const optionID = catalogID(selected.optionId);
    const choiceID = catalogID(selected.optionChoiceId);
    const option = catalog.options.find((candidate) => candidate.id === optionID);
    const choice = option?.choices.find((candidate) => candidate.id === choiceID);
    if (!option || !choice || choice.state !== "ON_SALE" || !Number.isSafeInteger(selected.quantity) || selected.quantity <= 0) {
      throw new Error(`토스 POS에서 주문 옵션을 찾을 수 없음: ${selected.optionId}/${selected.optionChoiceId}`);
    }
    return { id: choiceID, quantity: selected.quantity };
  });
}

function buildOrderDTO(
  claim: ClaimedOrder,
  catalog: PluginCatalogItem,
  tableID: number
): PluginOrderDto {
  const memo = claim.order.requestNote.trim();
  return {
    orderKey: claim.order.orderId,
    tableId: tableID,
    ...(memo ? { memo } : {}),
    discounts: [],
    lineItems: [
      {
        diningOption: "HERE",
        item: {
          id: catalog.id,
          title: catalog.title,
          ...(catalog.code ? { code: catalog.code } : {}),
          category: catalog.category,
          type: "ITEM"
        },
        quantity: { value: 1 },
        chargePrice: { value: claim.order.baseAmount },
        optionChoices: selectedOptions(catalog, claim),
        discounts: [],
        ...(memo ? { memo } : {})
      }
    ]
  };
}

export async function syncClaim(
  dependencies: POSDependencies,
  claim: ClaimedOrder,
  mappings: TableMappings
): Promise<string> {
  const tables = await dependencies.getTables();
  const targetTable = resolveTable(tables, claim.order.tableNumber, mappings);
  if (!targetTable) {
    throw new Error(`토스 POS 테이블을 찾을 수 없음: ${claim.order.tableNumber}`);
  }

  const catalog = await dependencies.getCatalog(catalogID(claim.order.catalogItemId));
  const dto = buildOrderDTO(claim, catalog, targetTable.id);
  const result = targetTable.order
    ? await dependencies.addMenu(targetTable.order.id, dto)
    : await dependencies.add(dto);
  return result.id;
}
