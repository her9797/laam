"use client";

import { useEffect, useState } from "react";

import { CategoryNav } from "@/components/navigation/category-nav";
import type { MenuCategory } from "@/data/menu-data";

type FloatingCategoryNavProps = {
  categories: MenuCategory[];
  activeCategoryId?: string;
};

export function FloatingCategoryNav({
  categories,
  activeCategoryId,
}: FloatingCategoryNavProps) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setStuck(window.scrollY > 120);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className={stuck ? "floating-subnav-shell stuck" : "floating-subnav-shell"}>
      <CategoryNav categories={categories} activeCategoryId={activeCategoryId} />
    </div>
  );
}
