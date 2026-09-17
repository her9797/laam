"use client";

import "@/i18n/client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  RiAlarmWarningLine,
  RiArchive2Line,
  RiArrowDownSLine,
  RiBarChart2Line,
  RiDashboardLine,
  RiFileTextLine,
  RiFolderLine,
  RiListCheck2,
  RiMegaphoneLine,
  RiMusic2Line,
  RiPlayCircleLine,
  RiQrCodeLine,
  RiRestaurantLine,
  RiShoppingBag3Line,
  RiShoppingCart2Line,
  RiStarLine,
  RiUserVoiceLine,
  RiWallet3Line,
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
  useSidebar,
} from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
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

// A labeled sub-section rather than its own link — expenses and inventory
// are separate screens that share their categories and purchase records.
const INVENTORY_NAV_GROUP: NavGroup = {
  labelKey: "navInventoryGroup",
  icon: RiArchive2Line,
  items: [
    { href: "/expenses", labelKey: "navExpenses", icon: RiWallet3Line },
    { href: "/inventory", labelKey: "navInventory", icon: RiArchive2Line },
    { href: "/inventory/items", labelKey: "navInventoryItems", icon: RiListCheck2 },
  ],
};

const NAV_GROUPS: NavGroup[] = [
  REQUEST_NAV_GROUP,
  ORDER_NAV_GROUP,
  PRODUCT_NAV_GROUP,
  INVENTORY_NAV_GROUP,
];

const BOTTOM_NAV_ITEMS: NavItem[] = [
  { href: "/tables", labelKey: "navTables", icon: RiQrCodeLine },
  { href: "/notices", labelKey: "navNotices", icon: RiMegaphoneLine },
  { href: "/store-copy", labelKey: "navStoreCopy", icon: RiFileTextLine },
  // A standalone top-level item, not folded into any of the grouped
  // dropdowns above — this is an operational diagnostics screen, not a
  // guest-request/order/product management concern.
  { href: "/system-logs", labelKey: "navSystemLogs", icon: RiAlarmWarningLine },
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

function findGroupKey(item: NavItem | undefined): string | null {
  if (!item) {
    return null;
  }
  const group = NAV_GROUPS.find((navGroup) =>
    navGroup.items.some((groupItem) => groupItem.href === item.href),
  );
  return group?.labelKey ?? null;
}

function AdminShellContent({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const activeItem = findActiveItem(pathname);
  const activeGroupKey = findGroupKey(activeItem);
  // The one expanded dropdown (by group labelKey), if any — opening another
  // collapses it. It starts as the group holding the current route, so
  // landing directly on one of its routes (e.g. from the dashboard's shortcut
  // card) reveals it without requiring a click first, and every navigation
  // resets it to that, so a dropdown toggled open on the previous screen
  // doesn't linger. Stored with the pathname it applies to, which is how a
  // navigation is noticed during render without an effect.
  const [expandedGroup, setExpandedGroup] = useState({ pathname, labelKey: activeGroupKey });
  if (expandedGroup.pathname !== pathname) {
    setExpandedGroup({ pathname, labelKey: activeGroupKey });
  }

  function isGroupOpen(group: NavGroup) {
    return expandedGroup.labelKey === group.labelKey;
  }

  function toggleGroup(group: NavGroup) {
    setExpandedGroup((expanded) => ({
      ...expanded,
      labelKey: expanded.labelKey === group.labelKey ? null : group.labelKey,
    }));
  }

  // Choosing a menu entry collapses every dropdown except the one the entry
  // itself sits in (`groupKey`, null for a top-level link) right away rather
  // than after the navigation, which re-selecting the current screen never
  // triggers. Only the mobile sheet is closed; the desktop sidebar keeps the
  // expanded/collapsed state the operator chose.
  function handleNavLinkClick(groupKey: string | null) {
    setExpandedGroup((expanded) => ({ ...expanded, labelKey: groupKey }));
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    // Only a 2xx means the route actually cleared the session cookie. After a
    // network error or non-2xx the cookie may still be set, so redirecting
    // would merely look logged out while `/dashboard` still lets the operator
    // straight back in — stay here, say so, and re-enable the button instead.
    let isLoggedOut = false;
    try {
      const response = await fetch("/api/auth/admin-logout", { method: "POST" });
      isLoggedOut = response.ok;
    } catch {
      // A network failure is handled below exactly like a non-2xx response.
    }

    if (!isLoggedOut) {
      toast.add({ title: t("logoutFailed") });
      setIsLoggingOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  function renderNavItem(item: NavItem) {
    const Icon = item.icon;
    const isActive = activeItem?.href === item.href;
    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          isActive={isActive}
          render={<Link href={item.href} />}
          onClick={() => handleNavLinkClick(null)}
        >
          <Icon className="size-4" />
          <span>{t(item.labelKey)}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <>
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
                                  <SidebarMenuSubButton
                                    isActive={isActive}
                                    render={<Link href={item.href} />}
                                    onClick={() => handleNavLinkClick(group.labelKey)}
                                  >
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
    </>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      {/* Around the content rather than inside it, so the content can read
          `useSidebar()` (to close the mobile sheet after choosing a link). */}
      <SidebarProvider>
        <AdminShellContent>{children}</AdminShellContent>
      </SidebarProvider>
    </ThemeProvider>
  );
}
