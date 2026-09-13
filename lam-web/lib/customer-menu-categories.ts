import type { MenuCategory } from "@/data/menu-data";

const customerMenuCategoryDefinitions = [
  { ids: ["signature"], label: "시그니처" },
  { ids: ["highball"], label: "하이볼" },
  { ids: ["whisky"], label: "위스키" },
  { ids: ["cocktail", "wine"], label: "칵테일" },
  { ids: ["non-alcohol"], label: "논알콜" },
] as const;

export function getCustomerMenuCategories(categories: MenuCategory[]) {
  const customerCategories: MenuCategory[] = [];

  for (const definition of customerMenuCategoryDefinitions) {
    const category = definition.ids
      .map((id) => categories.find((candidate) => candidate.id === id && candidate.isVisible !== false))
      .find(Boolean);

    if (category) {
      customerCategories.push({ ...category, label: definition.label });
    }
  }

  return customerCategories;
}
