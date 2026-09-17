import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/fetch-json", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/fetch-json")>(
    "@/lib/api/fetch-json",
  );
  return { ...actual, fetchJson: vi.fn() };
});

const toastAddMock = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: { add: (...args: unknown[]) => toastAddMock(...args) },
}));

import i18n from "@/i18n/client";
import { fetchJson } from "@/lib/api/fetch-json";

import { InventoryPage } from "./InventoryPage";
import type { ExpenseCategory, InventoryAdjustment, InventoryItem } from "./model";

const fetchJsonMock = vi.mocked(fetchJson);

const CATEGORIES: ExpenseCategory[] = [
  { id: "liquor", name: "술", sortOrder: 1, isDefault: true },
  { id: "garnish", name: "가니시", sortOrder: 3, isDefault: true },
];

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item",
    name: "item",
    categoryId: "liquor",
    unit: "병",
    quantity: 5,
    minQuantity: 2,
    isArchived: false,
    needsReorder: false,
    needsCheck: false,
    lastUnitPrice: null,
    lastPurchasedAt: null,
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const GIN = item({ id: "gin", name: "진", quantity: 1, minQuantity: 3, needsReorder: true, lastUnitPrice: 32000 });
const LIME = item({
  id: "lime",
  name: "라임",
  categoryId: "garnish",
  unit: "개",
  quantity: -2,
  minQuantity: 5,
  needsReorder: true,
  needsCheck: true,
});
const RUM = item({ id: "rum", name: "럼", quantity: 6 });

const ADJUSTMENTS: InventoryAdjustment[] = [
  {
    id: "adj-1",
    itemId: "gin",
    delta: 2,
    quantityAfter: 1,
    reason: "purchase",
    receiptId: "receipt-1",
    createdAt: "2026-09-10T01:00:00Z",
  },
];

let items: InventoryItem[];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <InventoryPage />
    </QueryClientProvider>,
  );
}

function row(name: string) {
  return screen.getByRole("listitem", { name });
}

beforeEach(async () => {
  items = [GIN, LIME, RUM];
  fetchJsonMock.mockReset();
  toastAddMock.mockReset();
  fetchJsonMock.mockImplementation(async (url, init) => {
    if (url === "/api/admin/expense-categories") return CATEGORIES;
    if (url === "/api/admin/inventory-items?includeArchived=false") return items;
    if (url === "/api/admin/inventory-items/gin/adjustments?limit=20") return ADJUSTMENTS;
    if (url === "/api/admin/inventory-items/gin/adjust") {
      const body = JSON.parse(String(init?.body)) as { delta?: number; set?: number };
      return { ...GIN, quantity: body.set ?? GIN.quantity + (body.delta ?? 0) };
    }
    if (url === "/api/admin/inventory-items/gin" && init?.method === "PATCH") {
      return { ...GIN, ...JSON.parse(String(init.body)) };
    }
    throw new Error(`unexpected ${String(url)}`);
  });
  await i18n.changeLanguage("ko");
});

afterEach(() => {
  cleanup();
});

describe("InventoryPage", () => {
  it("guides the operator to add items when there are none", async () => {
    items = [];
    renderPage();

    expect(await screen.findByText("아직 등록한 품목이 없어요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "품목 추가하러 가기" })).toHaveAttribute("href", "/inventory/items");
  });

  it("lists items needing an order at the top and flags quantities below zero", async () => {
    renderPage();

    const reorder = await screen.findByRole("region", { name: "주문 필요 2" });
    expect(within(reorder).getByText("진")).toBeInTheDocument();
    expect(within(reorder).getByText("라임")).toBeInTheDocument();
    expect(within(reorder).queryByText("럼")).not.toBeInTheDocument();
    expect(within(row("라임")).getByText("수량 확인 필요")).toBeInTheDocument();
    expect(within(row("진")).queryByText("수량 확인 필요")).not.toBeInTheDocument();
  });

  it("filters rows by category chip and by search", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "럼" });

    fireEvent.click(screen.getByRole("button", { name: "가니시" }));
    expect(screen.getByRole("button", { name: "가니시" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("listitem", { name: "럼" })).not.toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "라임" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "전체" }));
    fireEvent.change(screen.getByPlaceholderText("품목 이름 검색"), { target: { value: "럼" } });
    expect(screen.getByRole("listitem", { name: "럼" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "진" })).not.toBeInTheDocument();
  });

  it("shows +/- taps immediately with 44px touch targets and saves them together", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "진" });

    const plus = within(row("진")).getByRole("button", { name: "진 1 늘리기" });
    expect(plus.className).toContain("size-11");
    expect(within(row("진")).getByRole("button", { name: "진 1 줄이기" }).className).toContain("size-11");

    fireEvent.click(plus);
    fireEvent.click(plus);

    // Shown well before the 600ms debounce sends anything.
    await waitFor(
      () =>
        expect(within(row("진")).getByRole("button", { name: /진 지금 남은 수량 입력/ })).toHaveTextContent("3"),
      { timeout: 300 },
    );
    expect(fetchJsonMock).not.toHaveBeenCalledWith("/api/admin/inventory-items/gin/adjust", expect.anything());
    await waitFor(
      () =>
        expect(fetchJsonMock).toHaveBeenCalledWith(
          "/api/admin/inventory-items/gin/adjust",
          expect.objectContaining({ body: JSON.stringify({ delta: 2 }) }),
        ),
      { timeout: 2000 },
    );
  });

  it("sets the quantity left from the number button with a numeric keyboard", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "진" });

    fireEvent.click(within(row("진")).getByRole("button", { name: /진 지금 남은 수량 입력/ }));
    const input = await screen.findByLabelText("남은 수량");
    expect(input).toHaveAttribute("inputmode", "numeric");

    fireEvent.change(input, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("수량은 0 이상의 정수로 입력해 주세요.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/admin/inventory-items/gin/adjust",
        expect.objectContaining({ body: JSON.stringify({ set: 7 }) }),
      ),
    );
    await waitFor(() =>
      expect(within(row("진")).getByRole("button", { name: /진 지금 남은 수량 입력/ })).toHaveTextContent("7"),
    );
  });

  it("opens the item detail with history, last unit price and a minimum quantity editor", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "진" });

    fireEvent.click(within(row("진")).getByRole("button", { name: "진" }));

    const detail = await screen.findByRole("dialog", { name: "진" });
    expect(within(detail).getByText("32,000원")).toBeInTheDocument();
    expect(await within(detail).findByText("구매")).toBeInTheDocument();
    expect(within(detail).getByText("+2 → 1")).toBeInTheDocument();

    const minInput = within(detail).getByLabelText("최소 수량");
    expect(minInput).toHaveAttribute("inputmode", "numeric");
    fireEvent.change(minInput, { target: { value: "4" } });
    fireEvent.click(within(detail).getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/admin/inventory-items/gin",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ minQuantity: 4 }) }),
      ),
    );
  });
});
