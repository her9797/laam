import { MenuItemCard } from "@/components/menu/menu-item-card";
import { CategoryNav } from "@/components/navigation/category-nav";
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

        <div className="category-nav-shell">
          <CategoryNav categories={categories} activeCategoryId={category.id} />
        </div>

        <section className="content-card">
          <div className="menu-list">
            {items.map((item) => (
              <MenuItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
