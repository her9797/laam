import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { ItemsManagementPage } from "./ItemsManagementPage";
import type { ExpenseCategory, InventoryItem } from "./model";

const fetchJsonMock = vi.mocked(fetchJson);

const CATEGORIES: ExpenseCategory[] = [
  { id: "liquor", name: "술", sortOrder: 1, isDefault: true },
  { id: "ice", name: "얼음", sortOrder: 7, isDefault: false },
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

const GIN = item({ id: "gin", name: "진" });
const OLD_RUM = item({ id: "old-rum", name: "옛날 럼", isArchived: true });

let activeItems: InventoryItem[];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ItemsManagementPage />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  activeItems = [GIN];
  fetchJsonMock.mockReset();
  toastAddMock.mockReset();
  fetchJsonMock.mockImplementation(async (url, init) => {
    if (url === "/api/admin/expense-categories" && !init) return CATEGORIES;
    if (url === "/api/admin/expense-categories" && init?.method === "POST") {
      return { id: "new", name: "시럽", sortOrder: 8, isDefault: false };
    }
    if (url === "/api/admin/expense-categories/liquor" && init?.method === "PATCH") {
      return { ...CATEGORIES[0], name: "주류" };
    }
    if (url === "/api/admin/inventory-items?includeArchived=false") return activeItems;
    if (url === "/api/admin/inventory-items?includeArchived=true") return [...activeItems, OLD_RUM];
    if (url === "/api/admin/inventory-items/gin" && init?.method === "PATCH") return { ...GIN, isArchived: true };
    if (url === "/api/admin/inventory-items/old-rum" && init?.method === "PATCH") {
      return { ...OLD_RUM, isArchived: false };
    }
    throw new Error(`unexpected ${String(url)} ${init?.method ?? "GET"}`);
  });
  await i18n.changeLanguage("ko");
});

afterEach(() => {
  cleanup();
});

describe("ItemsManagementPage", () => {
  it("tells the operator how to add the first item", async () => {
    activeItems = [];
    renderPage();

    expect(await screen.findByText("아직 등록한 품목이 없어요.")).toBeInTheDocument();
    expect(screen.getByText("품목 추가 버튼을 눌러 품목을 추가해 보세요.")).toBeInTheDocument();
  });

  it("opens the add item sheet", async () => {
    renderPage();
    await screen.findByText("진");

    fireEvent.click(screen.getByRole("button", { name: "품목 추가" }));

    expect(await screen.findByRole("dialog", { name: "품목 추가" })).toBeInTheDocument();
  });

  it("archives an item", async () => {
    renderPage();
    await screen.findByText("진");

    fireEvent.click(screen.getByRole("button", { name: "진 보관" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/admin/inventory-items/gin",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ isArchived: true }) }),
      ),
    );
    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "진 품목을 보관했어요. 재고 화면에서 숨겨져요." }),
    );
  });

  it("shows archived items on request and restores them", async () => {
    renderPage();
    await screen.findByText("진");
    expect(screen.queryByText("옛날 럼")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "보관한 품목도 보기" }));

    const archivedRow = (await screen.findByText("옛날 럼")).closest("li") as HTMLElement;
    expect(within(archivedRow).getByText("보관됨")).toBeInTheDocument();
    fireEvent.click(within(archivedRow).getByRole("button", { name: "옛날 럼 복원" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/admin/inventory-items/old-rum",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ isArchived: false }) }),
      ),
    );
  });

  it("marks default categories and adds a new category", async () => {
    renderPage();
    const categories = await screen.findByRole("region", { name: "분류" });
    const liquorRow = (await within(categories).findByText("술")).closest("li") as HTMLElement;
    expect(within(liquorRow).getByText("기본")).toBeInTheDocument();
    const iceRow = within(categories).getByText("얼음").closest("li") as HTMLElement;
    expect(within(iceRow).queryByText("기본")).not.toBeInTheDocument();

    fireEvent.click(within(categories).getByRole("button", { name: "분류 추가" }));
    expect(await within(categories).findByText("분류 이름을 입력해 주세요.")).toBeInTheDocument();

    fireEvent.change(within(categories).getByLabelText("새 분류 이름"), { target: { value: "시럽" } });
    fireEvent.click(within(categories).getByRole("button", { name: "분류 추가" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/admin/expense-categories",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "시럽" }) }),
      ),
    );
    await waitFor(() => expect(within(categories).getByLabelText("새 분류 이름")).toHaveValue(""));
  });

  it("renames a default category", async () => {
    renderPage();
    const categories = await screen.findByRole("region", { name: "분류" });
    await within(categories).findByText("술");

    fireEvent.click(within(categories).getByRole("button", { name: "술 이름 변경" }));
    const dialog = await screen.findByRole("dialog", { name: "분류 이름 변경" });
    const input = within(dialog).getByLabelText("분류 이름");
    expect(input).toHaveValue("술");
    fireEvent.change(input, { target: { value: "주류" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/admin/expense-categories/liquor",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "주류" }) }),
      ),
    );
  });
});
