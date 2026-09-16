import type { MenuOption } from "../data/menu-data.ts";

export type MenuOptionSelection = Record<string, number>;

export function validateMenuOptionSelection(options: MenuOption[], selection: MenuOptionSelection) {
  for (const option of options) {
    const selectedCount = option.choices.filter((choice) => (selection[choice.id] ?? 0) > 0).length;
    if (selectedCount === 0 && !option.required) {
      continue;
    }
    const minimum = option.required ? Math.max(1, option.minChoices) : option.minChoices;
    if (selectedCount < minimum) {
      return `${option.title} 옵션을 선택해 주세요.`;
    }
    if (option.maxChoices > 0 && selectedCount > option.maxChoices) {
      return `${option.title} 옵션은 최대 ${option.maxChoices}개까지 선택할 수 있어요.`;
    }
  }
  return "";
}

export function getMenuOrderTotal(basePrice: number, options: MenuOption[], selection: MenuOptionSelection) {
  return options.reduce(
    (total, option) =>
      total + option.choices.reduce((sum, choice) => sum + choice.priceValue * (selection[choice.id] ?? 0), 0),
    basePrice,
  );
}

export function parseWonPrice(price: string) {
  const normalized = price.replaceAll(",", "").replace(/원.*$/, "").trim();
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}
