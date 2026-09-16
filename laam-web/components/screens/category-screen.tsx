import { PaginatedMenuList } from "@/components/menu/paginated-menu-list";
import { FloatingCategoryNav } from "@/components/navigation/floating-category-nav";
import { FloatingHomeBadge } from "@/components/navigation/floating-home-badge";
import { ScrollTopButton } from "@/components/navigation/scroll-top-button";
import type { MenuCategory, MenuItem, StoreInfo } from "@/data/menu-data";

type CategoryScreenProps = {
  store: StoreInfo;
  categories: MenuCategory[];
  category: MenuCategory;
  items: MenuItem[];
};

export function CategoryScreen({ store, categories, category, items }: CategoryScreenProps) {
  return (
    <main className="page-shell">
      <FloatingHomeBadge />
      <ScrollTopButton />
      <div className="phone-frame">
        <header className="hero-card compact">
          <p className="eyebrow">BAR LAAM</p>
          <h1>{category.label}</h1>
          <p className="hero-copy">{store.name}의 {category.label} 전체 메뉴</p>
        </header>

        <FloatingCategoryNav categories={categories} activeCategoryId={category.id} />

        <section className="content-card">
          <PaginatedMenuList key={category.id} items={items} />
        </section>
      </div>
    </main>
  );
}
