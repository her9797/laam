import { FloatingHomeBadge } from "@/components/navigation/floating-home-badge";
import { PrimaryNav } from "@/components/navigation/primary-nav";
import type { MenuCategory, MenuItem, StoreInfo } from "@/data/menu-data";
import { customerNavigationItems } from "@/lib/customer-navigation";
import Link from "next/link";

type HomeScreenProps = {
  store: StoreInfo;
  featuredCategory?: MenuCategory;
  featuredItems: MenuItem[];
  canEditTable: boolean;
};

export function HomeScreen({ store, canEditTable }: HomeScreenProps) {
  return (
    <main className="page-shell">
      <FloatingHomeBadge active />
      <div className="phone-frame">
        <header className="hero-card">
          <p className="eyebrow">BAR LAAM</p>
          <h1>{store.name}</h1>
          <div className="hero-badge-row">
            <a
              className="hero-link-badge"
              href="https://www.instagram.com/bar_laam/"
              target="_blank"
              rel="noreferrer"
            >
              Instagram
            </a>
          </div>
          <p className="hero-meta">{store.address}</p>
        </header>
        <PrimaryNav canEditTable={canEditTable} />

        <section className="home-vinyl-card" aria-label="BAR LAAM 음악 안내">
          <div className="home-vinyl-copy">
            <p className="section-kicker">after dark</p>
            <h2>
              COME AS
              <br />
              <span>YOU ARE.</span>
            </h2>
            <p>편하게 머물다 가세요.</p>
          </div>
          <div className="home-vinyl-record" aria-hidden="true">
            <div className="home-vinyl-label">
              <span>laam</span>
            </div>
          </div>
          <nav className="home-feature-links" aria-label="손님 메뉴 안내">
            {customerNavigationItems.map((item) => (
              <Link key={item.key} href={item.href}>
                <strong>{item.label}</strong>
                <span>{item.description}</span>
                <b aria-hidden="true">→</b>
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </main>
  );
}
