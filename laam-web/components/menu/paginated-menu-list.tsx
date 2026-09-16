"use client";

import { useRef, useState } from "react";

import { MenuItemCard } from "@/components/menu/menu-item-card";
import type { MenuItem } from "@/data/menu-data";
import { paginateItems } from "@/lib/pagination";

const MENU_PAGE_SIZE = 5;

export function PaginatedMenuList({ items }: { items: MenuItem[] }) {
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  const pagination = paginateItems(items, page, MENU_PAGE_SIZE);

  function handlePageChange(nextPage: number) {
    setPage(nextPage);
    window.requestAnimationFrame(() => {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div ref={listRef}>
      <div className="menu-list">
        {pagination.items.map((item) => (
          <MenuItemCard key={item.id} item={item} />
        ))}
      </div>

      {pagination.total > 0 ? (
        <div className="customer-menu-pagination" aria-label="메뉴 페이지 이동">
          <span>총 {pagination.total}개</span>
          <div className="customer-menu-page-controls">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              이전
            </button>
            <span aria-live="polite">
              {pagination.page} / {pagination.pageCount}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.pageCount}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              다음
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
