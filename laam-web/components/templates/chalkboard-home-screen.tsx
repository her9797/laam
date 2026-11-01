import Link from "next/link";

import { SecretCouponHotspot } from "@/components/easter-egg/secret-coupon-hotspot";
import { TableSessionBadge } from "@/components/table/table-session-badge";
import type { NoticeItem, StoreInfo } from "@/data/menu-data";

type ChalkboardHomeScreenProps = {
  store: StoreInfo;
  canEditTable: boolean;
  notice?: NoticeItem;
};

const CHALK_LINKS = [
  { href: "/song-requests", label: "노래 신청", description: "듣고 싶은 곡", tone: "blue" },
  { href: "/requests", label: "사장님께 한마디", description: "편하게 남겨요", tone: "pink" },
  { href: "/special-requests", label: "특별한 요청", description: "비밀이에요", tone: "yellow" },
  { href: "/events", label: "공지 · 이벤트", description: "오늘의 소식", tone: "green" },
];

export function ChalkboardHomeScreen({ store, canEditTable, notice }: ChalkboardHomeScreenProps) {
  return (
    <main className="page-shell chalk-home">
      <TableSessionBadge canEdit={canEditTable} />
      <div className="phone-frame">
        <p className="chalk-since">since 2026 · 망원</p>

        <header className="chalk-sign">
          <SecretCouponHotspot couponId="vinyl-laam" className="chalk-logo-secret">
            <img src="/brand/laam-logo.jpg" alt={store.name} />
          </SecretCouponHotspot>
          <h1>
            Bar Laam <span aria-hidden="true">↘</span>
          </h1>
          <p>지하 1층, 우리들의 아지트</p>
        </header>

        <nav className="chalk-nav" aria-label="손님 메뉴 안내">
          <Link href="/menu" className="chalk-menu-link">
            <strong>오늘의 메뉴</strong>
            <span aria-hidden="true">→</span>
          </Link>
          {CHALK_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="chalk-nav-item" data-tone={link.tone}>
              <span className="chalk-check" aria-hidden="true">
                ✓
              </span>
              <span className="chalk-nav-label">{link.label}</span>
              <span className="chalk-nav-description">{link.description}</span>
            </Link>
          ))}
        </nav>

        {notice ? (
          <Link href="/events" className="chalk-notice">
            {notice.text}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
