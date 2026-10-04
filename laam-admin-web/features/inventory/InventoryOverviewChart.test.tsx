import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no layout; give ResponsiveContainer a fixed size.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  const { cloneElement } = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 400, height: 300 }),
  };
});

import i18n from "@/i18n/client";

import { InventoryOverviewChart } from "./InventoryOverviewChart";
import type { InventoryItem } from "./model";

function item(name: string, quantity: number, minQuantity: number): InventoryItem {
  return {
    id: name,
    name,
    categoryId: "c",
    unit: "병",
    quantity,
    minQuantity,
    isArchived: false,
    needsReorder: minQuantity > 0 && quantity < minQuantity,
    needsCheck: quantity < 0,
    lastUnitPrice: null,
    lastPurchasedAt: null,
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("ko");
});

afterEach(() => {
  cleanup();
});

describe("InventoryOverviewChart", () => {
  it("shows one titled card with status counts and an accessible chart", () => {
    render(
      <InventoryOverviewChart
        items={[item("맥주", 30, 10), item("소주", 3, 10), item("라임", -2, 5), item("빨대", 9, 0)]}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "재고 현황" })).toBeInTheDocument();
    const summary = screen.getByTestId("stock-overview-summary");
    expect(summary).toHaveTextContent("전체 4개");
    const rows = within(summary).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "정상1",
      "주문 필요1",
      "확인 필요1",
      "최소 수량 미설정1",
    ]);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "전체 4개 품목 재고 막대 차트: 정상 1개, 주문 필요 1개, 확인 필요 1개, 최소 수량 미설정 1개",
    );
  });

  it("lists every item in the screen-reader list, in status order, including unset ones", () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`품목${String(i).padStart(2, "0")}`, 20, 10));
    render(<InventoryOverviewChart items={[...many, item("빨대", 9, 0), item("라임", -2, 5), item("소주", 3, 10)]} />);

    const list = screen.getByTestId("stock-overview-items");
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(15);
    expect(entries[0]).toHaveTextContent("라임 · -2/5 병");
    expect(entries[1]).toHaveTextContent("소주 · 3/10 병");
    expect(entries[14]).toHaveTextContent("빨대 · 9 병 · 최소 수량 미설정");
    expect(list.className).toContain("sr-only");
  });

  it("scales the chart height with the number of items", () => {
    const { rerender } = render(<InventoryOverviewChart items={[item("a", 1, 1)]} />);
    const small = parseInt(screen.getByRole("img").style.height, 10);
    rerender(<InventoryOverviewChart items={Array.from({ length: 20 }, (_, i) => item(`n${i}`, 1, 1))} />);
    const large = parseInt(screen.getByRole("img").style.height, 10);
    expect(large).toBeGreaterThan(small + 400);
  });
});
