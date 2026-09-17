import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { FetchJsonError, fetchJson } from "@/lib/api/fetch-json";

import { ItemFormSheet } from "./ItemFormSheet";
import type { ExpenseCategory, InventoryItem } from "./model";

const fetchJsonMock = vi.mocked(fetchJson);

const CATEGORIES: ExpenseCategory[] = [
  { id: "liquor", name: "술", sortOrder: 1, isDefault: true },
  { id: "garnish", name: "가니시", sortOrder: 3, isDefault: true },
];

const LIME: InventoryItem = {
  id: "lime",
  name: "라임",
  categoryId: "garnish",
  unit: "개",
  quantity: 10,
  minQuantity: 5,
  isArchived: false,
  needsReorder: false,
  needsCheck: false,
  lastUnitPrice: null,
  lastPurchasedAt: null,
  updatedAt: "2026-09-01T00:00:00Z",
};

function renderSheet(props: Partial<React.ComponentProps<typeof ItemFormSheet>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ItemFormSheet open onOpenChange={onOpenChange} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onSaved, onOpenChange };
}

async function chooseCategory(label: string) {
  const select = screen.getByRole("combobox", { name: "분류" });
  await screen.findByRole("option", { name: label });
  const option = screen.getByRole("option", { name: label }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: option.value } });
}

beforeEach(async () => {
  fetchJsonMock.mockReset();
  toastAddMock.mockReset();
  fetchJsonMock.mockImplementation(async (url) => {
    if (url === "/api/admin/expense-categories") return CATEGORIES;
    throw new Error(`unexpected ${String(url)}`);
  });
  await i18n.changeLanguage("ko");
});

afterEach(() => {
  cleanup();
});

describe("ItemFormSheet", () => {
  it("explains every missing required field instead of submitting", async () => {
    renderSheet();

    fireEvent.click(await screen.findByRole("button", { name: "추가" }));

    expect(await screen.findByText("이름을 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("분류를 선택해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("단위를 입력하거나 추천 단위를 눌러 주세요.")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalledWith("/api/admin/inventory-items", expect.anything());
  });

  it("uses numeric keyboards for quantities and fills the unit from a suggestion chip", async () => {
    renderSheet();

    expect(screen.getByLabelText("시작 수량")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("최소 수량")).toHaveAttribute("inputmode", "numeric");

    fireEvent.click(screen.getByRole("button", { name: "캔" }));
    expect(screen.getByLabelText("단위")).toHaveValue("캔");
  });

  it("creates an item and hands the created item back", async () => {
    const created = { ...LIME, id: "tonic", name: "토닉워터", categoryId: "liquor", unit: "병" };
    fetchJsonMock.mockImplementation(async (url, init) => {
      if (url === "/api/admin/expense-categories") return CATEGORIES;
      if (url === "/api/admin/inventory-items" && init?.method === "POST") return created;
      return [];
    });
    const { onSaved, onOpenChange } = renderSheet({ initialName: "토닉워터" });

    expect(screen.getByLabelText("이름")).toHaveValue("토닉워터");
    await chooseCategory("술");
    fireEvent.click(screen.getByRole("button", { name: "병" }));
    fireEvent.change(screen.getByLabelText("시작 수량"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("최소 수량"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/admin/inventory-items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "토닉워터", categoryId: "liquor", unit: "병", quantity: 3, minQuantity: 2 }),
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("explains how to fix a duplicate item name", async () => {
    fetchJsonMock.mockImplementation(async (url, init) => {
      if (url === "/api/admin/expense-categories") return CATEGORIES;
      if (init?.method === "POST") throw new FetchJsonError(409, "duplicate");
      return [];
    });
    const { onSaved } = renderSheet({ initialName: "라임" });

    await chooseCategory("가니시");
    fireEvent.click(screen.getByRole("button", { name: "개" }));
    fireEvent.click(screen.getByRole("button", { name: "추가" }));

    expect(
      await screen.findByText("같은 이름의 품목이 이미 있어요. 다른 이름을 쓰거나 기존 품목을 선택해 주세요."),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("edits an existing item without a starting quantity field", async () => {
    fetchJsonMock.mockImplementation(async (url, init) => {
      if (url === "/api/admin/expense-categories") return CATEGORIES;
      if (init?.method === "PATCH") return { ...LIME, minQuantity: 8 };
      return [];
    });
    const { onSaved } = renderSheet({ item: LIME });

    expect(screen.queryByLabelText("시작 수량")).not.toBeInTheDocument();
    expect(screen.getByLabelText("이름")).toHaveValue("라임");
    fireEvent.change(screen.getByLabelText("최소 수량"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/admin/inventory-items/lime",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "라임", categoryId: "garnish", unit: "개", minQuantity: 8 }),
      }),
    );
  });
});
