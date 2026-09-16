import Link from "next/link";

import type { MenuCategory } from "@/data/menu-data";

type CategoryNavProps = {
  categories: MenuCategory[];
  activeCategoryId?: string;
};

export function CategoryNav({ categories, activeCategoryId }: CategoryNavProps) {
  return (
    <nav className="category-strip subcategory-strip" aria-label="메뉴 카테고리">
      {categories.map((category) => (
        <Link
          key={category.id}
          className={
            category.id === activeCategoryId
              ? "category-pill subcategory-pill active"
              : "category-pill subcategory-pill"
          }
          href={`/menu/${category.id}`}
        >
          {category.label}
        </Link>
      ))}
    </nav>
  );
}
