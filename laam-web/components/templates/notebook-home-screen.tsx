import Link from "next/link";

import { SecretCouponHotspot } from "@/components/easter-egg/secret-coupon-hotspot";
import { TableSessionBadge } from "@/components/table/table-session-badge";
import { SocialLinks } from "@/components/templates/social-links";
import type { StoreInfo } from "@/data/menu-data";

type NotebookHomeScreenProps = {
  store: StoreInfo;
  canEditTable: boolean;
};

const TODO_ITEMS = [
  { href: "/menu", label: "메뉴 고르고 주문하기", highlight: true },
  { href: "/song-requests", label: "듣고 싶은 노래 신청하기" },
  { href: "/requests", label: "사장님께 한마디 남기기" },
  { href: "/special-requests", label: "특별한 요청 해보기", note: "(비밀!)" },
  { href: "/events", label: "공지 · 이벤트 확인하기" },
];

function todayLabel() {
  const parts = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).formatToParts(new Date());
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${month}월 ${day}일`;
}

function neighborhood(address: string) {
  return address.split(" ").find((token) => token.endsWith("동")) ?? "";
}

export function NotebookHomeScreen({ store, canEditTable }: NotebookHomeScreenProps) {
  const place = neighborhood(store.address);

  return (
    <main className="page-shell notebook-home">
      <TableSessionBadge canEdit={canEditTable} />
      <div className="phone-frame">
        <p className="notebook-date">
          {todayLabel()}
          {place ? ` · ${place}` : ""}
        </p>
        <h1 className="notebook-title">{store.name} 노트</h1>
        <div className="notebook-lead-row">
          <p className="notebook-lead">편하게 머물다 가세요.</p>
          <SocialLinks className="notebook-social" />
        </div>

        <figure className="notebook-polaroid">
          <span className="notebook-tape" aria-hidden="true" />
          <img src="/brand/laam-logo.jpg" alt={store.name} />
          <figcaption>
            <SecretCouponHotspot couponId="vinyl-laam" className="notebook-polaroid-secret">
              COME AS YOU ARE.
            </SecretCouponHotspot>
          </figcaption>
        </figure>

        <nav className="notebook-todo" aria-label="오늘 할 일">
          <p className="notebook-todo-title">오늘 할 일</p>
          {TODO_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={item.highlight ? "notebook-todo-item highlight" : "notebook-todo-item"}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 4.8c5-.6 10-.4 15 .2.4 4.6.3 9.4-.2 14.2-5 .5-10 .4-14.8-.3-.5-4.7-.5-9.4 0-14.1z" />
              </svg>
              <span>
                {item.label}
                {item.note ? <em> {item.note}</em> : null}
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
