import type { MenuItem } from "@/data/menu-data";

export function getMenuItemDetail(item: MenuItem) {
  return {
    name: item.name,
    price: item.price,
    description: item.description,
  };
}
