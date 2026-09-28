import { FloatingHomeBadge } from "@/components/navigation/floating-home-badge";
import { PrimaryNav } from "@/components/navigation/primary-nav";
import { SecretCouponTrigger } from "@/components/easter-egg/secret-coupon-trigger";
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
            <a
              className="hero-link-badge hero-link-badge--naver"
              href="https://map.naver.com/p/entry/place/2042961708?lng=126.908354&lat=37.5567325&placePath=%2Freview%3FadditionalHeight%3D76%26fromPanelNum%3D1%26locale%3Dko%26svcName%3Dmap_pcv5%26timestamp%3D202609280819&searchType=place&c=15.00,0,0,0,dh"
              target="_blank"
              rel="noreferrer"
            >
              NAVER
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
              <SecretCouponTrigger />
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
