import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/fetch-json", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/fetch-json")>(
    "@/lib/api/fetch-json",
  );
  return { ...actual, fetchJson: vi.fn() };
});

vi.mock("@/components/ui/toast", () => ({
  toast: { add: vi.fn() },
}));

import i18n from "@/i18n/client";
import { fetchJson } from "@/lib/api/fetch-json";

import { InventoryItemCombobox } from "./InventoryItemCombobox";
import type { ExpenseCategory, InventoryItem } from "./model";

const fetchJsonMock = vi.mocked(fetchJson);

const CATEGORIES: ExpenseCategory[] = [{ id: "beverage", name: "음료", sortOrder: 4, isDefault: true }];

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item",
    name: "item",
    categoryId: "beverage",
    unit: "병",
    quantity: 5,
    minQuantity: 0,
    isArchived: false,
    needsReorder: false,
    needsCheck: false,
    lastUnitPrice: null,
    lastPurchasedAt: null,
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const ITEMS = [
  item({ id: "cola", name: "콜라", lastPurchasedAt: null }),
  item({ id: "soda", name: "탄산수", lastPurchasedAt: "2026-09-10T00:00:00Z" }),
  item({ id: "juice", name: "주스", lastPurchasedAt: "2026-08-01T00:00:00Z" }),
];

const TONIC = item({ id: "tonic", name: "토닉워터" });

/** A stand-in receipt line form whose own input must survive adding an item. */
function Harness({ onChange }: { onChange: (item: InventoryItem) => void }) {
  const [memo, setMemo] = useState("");
  const [itemId, setItemId] = useState<string | null>(null);
  return (
    <div>
      <input aria-label="memo" value={memo} onChange={(event) => setMemo(event.target.value)} />
      <InventoryItemCombobox
        value={itemId}
        onChange={(picked) => {
          setItemId(picked.id);
          onChange(picked);
        }}
      />
    </div>
  );
}

function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <Harness onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange };
}

beforeEach(async () => {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockImplementation(async (url, init) => {
    if (url === "/api/admin/expense-categories") return CATEGORIES;
    if (url === "/api/admin/inventory-items?includeArchived=false") return ITEMS;
    if (url === "/api/admin/inventory-items" && init?.method === "POST") return TONIC;
    throw new Error(`unexpected ${String(url)}`);
  });
  await i18n.changeLanguage("ko");
});

afterEach(() => {
  cleanup();
});

describe("InventoryItemCombobox", () => {
  it("shows the snapshot name when the selected item is archived and absent from the active list", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InventoryItemCombobox value="archived-gin" fallbackLabel="보관된 진" onChange={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("combobox", { name: "보관된 진" })).toBeInTheDocument();
  });

  it("lists items by most recent purchase and picks one", async () => {
    const { onChange } = renderHarness();

    fireEvent.click(screen.getByRole("combobox", { name: "품목 선택" }));
    const listbox = await screen.findByRole("listbox");
    await within(listbox).findByRole("option", { name: "탄산수" });

    const names = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names.slice(0, 3)).toEqual(["탄산수", "주스", "콜라"]);

    fireEvent.click(within(listbox).getByRole("option", { name: "주스" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "juice" }));
    expect(screen.getByRole("combobox", { name: "주스" })).toBeInTheDocument();
  });

  it("filters by the search text", async () => {
    renderHarness();

    fireEvent.click(screen.getByRole("combobox", { name: "품목 선택" }));
    const listbox = await screen.findByRole("listbox");
    await within(listbox).findByRole("option", { name: "콜라" });
    fireEvent.change(screen.getByPlaceholderText("품목 이름 검색"), { target: { value: "탄산" } });

    expect(within(listbox).getByRole("option", { name: "탄산수" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "콜라" })).not.toBeInTheDocument();
  });

  it("adds a new item from the list, selects it, and keeps the parent form's input", async () => {
    const { onChange } = renderHarness();
    fireEvent.change(screen.getByLabelText("memo"), { target: { value: "cash only" } });

    fireEvent.click(screen.getByRole("combobox", { name: "품목 선택" }));
    const listbox = await screen.findByRole("listbox");
    await within(listbox).findByRole("option", { name: "콜라" });
    fireEvent.change(screen.getByPlaceholderText("품목 이름 검색"), { target: { value: "토닉워터" } });
    fireEvent.click(within(listbox).getByRole("option", { name: "'토닉워터' 품목 추가" }));

    const nameInput = await screen.findByLabelText("이름");
    expect(nameInput).toHaveValue("토닉워터");
    const categorySelect = screen.getByRole("combobox", { name: "분류" });
    await within(categorySelect).findByRole("option", { name: "음료" });
    fireEvent.change(categorySelect, { target: { value: "beverage" } });
    fireEvent.click(screen.getByRole("button", { name: "병" }));
    fireEvent.click(screen.getByRole("button", { name: "추가" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(TONIC));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "토닉워터" })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("memo")).toHaveValue("cash only");
  });
});
