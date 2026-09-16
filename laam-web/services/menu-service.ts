import {
  categories as fallbackCategories,
  menuItems as fallbackMenuItems,
  store as fallbackStore,
  type MenuCategory,
  type MenuItem,
  type StoreInfo,
} from "@/data/menu-data";

export type MenuData = {
  store: StoreInfo;
  categories: MenuCategory[];
  items: MenuItem[];
};

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:9090";
const MENU_ENDPOINT = "/api/v1/menu";

function getFallbackMenuData(): MenuData {
  return {
    store: fallbackStore,
    categories: fallbackCategories,
    items: fallbackMenuItems,
  };
}

function isMenuData(payload: unknown): payload is MenuData {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<MenuData>;

  return (
    !!candidate.store &&
    typeof candidate.store.name === "string" &&
    typeof candidate.store.subtitle === "string" &&
    typeof candidate.store.address === "string" &&
    Array.isArray(candidate.categories) &&
    Array.isArray(candidate.items)
  );
}

export async function getMenuData(): Promise<MenuData> {
  try {
    const response = await fetch(`${API_BASE_URL}${MENU_ENDPOINT}`, {
      cache: "no-store",
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(1500),
    });

    if (!response.ok) {
      throw new Error(`menu api request failed: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;

    if (!isMenuData(payload)) {
      throw new Error("menu api returned an invalid payload");
    }

    return payload;
  } catch (error) {
    console.warn("Falling back to local menu data.", error);
    return getFallbackMenuData();
  }
}

export function getFeaturedCategoryFromData(menuData: MenuData) {
  return (
    menuData.categories.find((category) => category.id === "signature") ??
    menuData.categories[0]
  );
}

export function getCategoryByIdFromData(
  menuData: MenuData,
  categoryId: string,
) {
  return menuData.categories.find((category) => category.id === categoryId);
}

export function getMenuItemsByCategoryFromData(
  menuData: MenuData,
  categoryId: string,
) {
  return menuData.items.filter((item) => item.categoryId === categoryId);
}

export function getFeaturedItemsFromData(menuData: MenuData) {
  const featuredCategory = getFeaturedCategoryFromData(menuData);
  return featuredCategory
    ? getMenuItemsByCategoryFromData(menuData, featuredCategory.id).slice(0, 3)
    : [];
}
