"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { CustomerTemplate } from "@/lib/customer-template";

const NOTEBOOK_TABS = [
  { href: "/menu", label: "메뉴", match: "/menu" },
  { href: "/song-requests", label: "노래", match: "/song-requests" },
  { href: "/requests", label: "한마디", match: "/requests" },
  { href: "/special-requests", label: "비밀", match: "/special-requests" },
  { href: "/events", label: "공지", match: "/events" },
] as const;

const HIDDEN_PATHS = ["/access-required", "/checkout", "/payments"];

/** 템플릿마다 모든 화면에 깔리는 공통 내비. classic은 지금 화면 그대로라 아무것도 그리지 않는다. */
export function TemplateChrome({ template }: { template: CustomerTemplate }) {
  const pathname = usePathname() ?? "/";

  if (template !== "notebook" || HIDDEN_PATHS.some((path) => pathname.startsWith(path))) {
    return null;
  }

  return (
    <nav className="notebook-index-tabs" aria-label="주요 메뉴">
      {NOTEBOOK_TABS.map((tab) => {
        const active = pathname === tab.match || pathname.startsWith(`${tab.match}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "notebook-index-tab active" : "notebook-index-tab"}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
