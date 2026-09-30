import type { MenuCategory, MenuItem } from "@/data/menu-data";

/**
 * The POS owns the category list, so its titles and order are used as they
 * arrive. A category with no visible item would render as an empty tab, so
 * it is left out until the POS files something under it.
 */
export function getCustomerMenuCategories(categories: MenuCategory[], items: MenuItem[]) {
  const categoryIdsWithItems = new Set(
    items.filter((item) => item.isVisible !== false).map((item) => item.categoryId),
  );

  return categories.filter(
    (category) => category.isVisible !== false && categoryIdsWithItems.has(category.id),
  );
}
