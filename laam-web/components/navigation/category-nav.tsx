"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import type { MenuCategory } from "@/data/menu-data";

type CategoryNavProps = {
  categories: MenuCategory[];
  activeCategoryId?: string;
};

export function CategoryNav({ categories, activeCategoryId }: CategoryNavProps) {
  const activePillRef = useRef<HTMLAnchorElement>(null);

  // Picking a category is a page navigation, so the strip re-renders scrolled
  // back to the start and a category near the right edge scrolls out of sight.
  // `block: "nearest"` keeps this from moving the page vertically as well.
  useEffect(() => {
    activePillRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeCategoryId]);

  return (
    <nav className="category-strip subcategory-strip" aria-label="메뉴 카테고리">
      {categories.map((category) => {
        const isActive = category.id === activeCategoryId;
        return (
          <Link
            key={category.id}
            ref={isActive ? activePillRef : undefined}
            className={
              isActive
                ? "category-pill subcategory-pill active"
                : "category-pill subcategory-pill"
            }
            href={`/menu/${category.id}`}
          >
            {category.label}
          </Link>
        );
      })}
    </nav>
  );
}
