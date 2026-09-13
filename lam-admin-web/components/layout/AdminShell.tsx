"use client";

import "@/i18n/client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  RiArrowDownSLine,
  RiBarChart2Line,
  RiDashboardLine,
  RiFileTextLine,
  RiFolderLine,
  RiMegaphoneLine,
  RiMusic2Line,
  RiPlayCircleLine,
  RiQrCodeLine,
  RiRestaurantLine,
  RiShoppingBag3Line,
  RiShoppingCart2Line,
  RiStarLine,
  RiUserVoiceLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { NotificationBells } from "@/features/notifications/NotificationBells";
import { LanguageMenu } from "@/features/settings/LanguageMenu";
import { ThemeMenu } from "@/features/settings/ThemeMenu";
import { ThemeProvider } from "@/features/settings/ThemeProvider";

// Must match the root layout's skip link target (`app/layout.tsx`) so the
// single global skip link works on admin pages too — this shell must not
// render a second, duplicate skip link.
const MAIN_CONTENT_ID = "main-content";

type NavItem = {
  href: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
};

const TOP_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", labelKey: "navDashboard", icon: RiDashboardLine },
  { href: "/player", labelKey: "navPlayer", icon: RiPlayCircleLine },
];

type NavGroup = { labelKey: string; icon: ComponentType<{ className?: string }>; items: NavItem[] };

// A labeled sub-section rather than its own link — only one screen exists
// today, but this is its own group (not folded into another) so later
// order-related screens (e.g. sales summaries) have somewhere to land.
const ORDER_NAV_GROUP: NavGroup = {
  labelKey: "navOrdersGroup",
  icon: RiShoppingCart2Line,
  items: [
    { href: "/orders", labelKey: "navOrders", icon: RiShoppingCart2Line },
    { href: "/orders/stats", labelKey: "navOrderStats", icon: RiBarChart2Line },
  ],
};

// A labeled sub-section rather than its own link — "요청 관리" has no page
// of its own, only the three request screens nested under it.
const REQUEST_NAV_GROUP: NavGroup = {
  labelKey: "navRequestsGroup",
  icon: RiUserVoiceLine,
  items: [
    { href: "/requests", labelKey: "navRequests", icon: RiUserVoiceLine },
    { href: "/song-requests", labelKey: "navSongRequests", icon: RiMusic2Line },
    { href: "/special-requests", labelKey: "navSpecialRequests", icon: RiStarLine },
  ],
};

// A labeled sub-section rather than its own link — "상품 관리" has no page
// of its own, only the two management screens nested under it.
const PRODUCT_NAV_GROUP: NavGroup = {
  labelKey: "navProducts",
  icon: RiShoppingBag3Line,
  items: [
    { href: "/menu", labelKey: "navMenu", icon: RiRestaurantLine },
    { href: "/menu/categories", labelKey: "navCategories", icon: RiFolderLine },
  ],
};

const NAV_GROUPS: NavGroup[] = [REQUEST_NAV_GROUP, ORDER_NAV_GROUP, PRODUCT_NAV_GROUP];

const BOTTOM_NAV_ITEMS: NavItem[] = [
  { href: "/tables", labelKey: "navTables", icon: RiQrCodeLine },
  { href: "/notices", labelKey: "navNotices", icon: RiMegaphoneLine },
  { href: "/store-copy", labelKey: "navStoreCopy", icon: RiFileTextLine },
];

const ALL_NAV_ITEMS: NavItem[] = [
  ...TOP_NAV_ITEMS,
  ...NAV_GROUPS.flatMap((group) => group.items),
  ...BOTTOM_NAV_ITEMS,
];

function findActiveItem(pathname: string | null): NavItem | undefined {
  if (!pathname) {
    return undefined;
  }
  const exactMatch = ALL_NAV_ITEMS.find((item) => pathname === item.href);
  if (exactMatch) {
    return exactMatch;
  }
  // "/menu/categories" starts with both "/menu/" and "/menu/categories/", so
  // prefix matches are resolved by the longest (most specific) href — plain
  // find() order would otherwise let "/menu" claim a "/menu/categories" path.
  return ALL_NAV_ITEMS.filter((item) => pathname.startsWith(`${item.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}

function AdminShellContent({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Manual toggle only, keyed by group labelKey; whether a dropdown is
  // actually shown also factors in the current route below, so landing
  // directly on one of its routes (e.g. from the dashboard's shortcut card)
  // reveals it without requiring a click first.
  const [toggledOpenGroups, setToggledOpenGroups] = useState<Record<string, boolean>>({});
  const activeItem = findActiveItem(pathname);

  function isGroupOpen(group: NavGroup) {
    const isOnGroupRoute = group.items.some((item) => activeItem?.href === item.href);
    return toggledOpenGroups[group.labelKey] || isOnGroupRoute;
  }

  function toggleGroup(group: NavGroup) {
    setToggledOpenGroups((open) => ({ ...open, [group.labelKey]: !open[group.labelKey] }));
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/admin-logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  function renderNavItem(item: NavItem) {
    const Icon = item.icon;
    const isActive = activeItem?.href === item.href;
    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton isActive={isActive} render={<Link href={item.href} />}>
          <Icon className="size-4" />
          <span>{t(item.labelKey)}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <span className="px-2 py-1 text-sm font-semibold text-sidebar-foreground">
            {t("appName")}
          </span>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label={t("navigation")}>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {TOP_NAV_ITEMS.map(renderNavItem)}
                  {NAV_GROUPS.map((group) => {
                    const isOpen = isGroupOpen(group);
                    return (
                      <SidebarMenuItem key={group.labelKey}>
                        <SidebarMenuButton
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => toggleGroup(group)}
                        >
                          <group.icon className="size-4" />
                          <span>{t(group.labelKey)}</span>
                          <RiArrowDownSLine
                            aria-hidden="true"
                            className={`ml-auto size-4 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                          />
                        </SidebarMenuButton>
                        {isOpen ? (
                          <SidebarMenuSub>
                            {group.items.map((item) => {
                              const Icon = item.icon;
                              const isActive = activeItem?.href === item.href;
                              return (
                                <SidebarMenuSubItem key={item.href}>
                                  <SidebarMenuSubButton isActive={isActive} render={<Link href={item.href} />}>
                                    <Icon className="size-4" />
                                    <span>{t(item.labelKey)}</span>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                  {BOTTOM_NAV_ITEMS.map(renderNavItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-center"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? t("loggingOut") : t("logout")}
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
          <SidebarTrigger aria-label={t("openMenu")} />
          <nav aria-label="breadcrumb" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <li>
                <Link href="/dashboard" className="hover:text-foreground">
                  {t("breadcrumbHome")}
                </Link>
              </li>
              {activeItem ? (
                <>
                  <li aria-hidden="true">/</li>
                  <li className="truncate font-medium text-foreground" aria-current="page">
                    {t(activeItem.labelKey)}
                  </li>
                </>
              ) : null}
            </ol>
          </nav>
          <div className="flex items-center gap-2">
            <NotificationBells />
            <LanguageMenu />
            <ThemeMenu />
          </div>
        </header>
        <main id={MAIN_CONTENT_ID} className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AdminShellContent>{children}</AdminShellContent>
    </ThemeProvider>
  );
}
