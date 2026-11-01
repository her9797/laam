import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "@/features/bootstrap/model";
import type { MenuItemRecipe } from "./model";

const useBootstrapQueryMock = vi.fn();

vi.mock("@/features/bootstrap/queries", () => ({
  useBootstrapQuery: () => useBootstrapQueryMock(),
}));

const useMenuItemRecipeQueryMock = vi.fn();
const updateMenuItemRecipeMutate = vi.fn();

function idleMutation(mutate: ReturnType<typeof vi.fn>) {
  return { mutate, isPending: false, isError: false, error: null as unknown };
}

const updateMenuItemRecipeMutationState = { current: idleMutation(updateMenuItemRecipeMutate) };
const updateMenuItemContentMutate = vi.fn();
const updateMenuItemContentMutationState = { current: idleMutation(updateMenuItemContentMutate) };

vi.mock("./queries", () => ({
  useMenuItemRecipeQuery: (id: string) => useMenuItemRecipeQueryMock(id),
  useUpdateMenuItemRecipeMutation: () => updateMenuItemRecipeMutationState.current,
  useUpdateMenuItemContentMutation: () => updateMenuItemContentMutationState.current,
}));

import { MenuItemDetailPage } from "./MenuItemDetailPage";

const FIXTURE: AppData = {
  store: { name: "가게", subtitle: "", address: "", songRequestCopy: "", requestCopy: "", eventCopy: "" },
  categories: [{ id: "food", label: "안주", isVisible: true }],
  items: [
    {
      id: "menu-1",
      categoryId: "food",
      name: "감자튀김",
      description: "바삭한 감자튀김",
      posDescription: "바삭한 감자튀김",
      descriptionOverride: "",
      customLabels: [],
      labels: [{ text: "BEST" }],
      price: "5000",
      imageUrl: "https://cdn.example.com/fries.png",
      isVisible: true,
      options: [
        {
          id: "option-sauce",
          title: "소스",
          required: true,
          minChoices: 1,
          maxChoices: 2,
          choices: [
            {
              id: "choice-cheese",
              title: "치즈 소스",
              priceValue: 500,
              quantityEnabled: true,
              minQuantity: 1,
              maxQuantity: 3,
            },
          ],
        },
      ],
    },
  ],
  requestGuides: [],
  notices: [],
};

const RECIPE_FIXTURE: MenuItemRecipe = {
  menuItemId: "menu-1",
  ingredients: "감자 200g, 소금",
  instructions: "180도에서 5분 튀긴다",
};

const bootstrapRefetchMock = vi.fn();
const recipeRefetchMock = vi.fn();

function defaultBootstrapResult() {
  return { data: FIXTURE, isLoading: false, isError: false, error: null as unknown, refetch: bootstrapRefetchMock };
}

function defaultRecipeResult() {
  return {
    data: RECIPE_FIXTURE,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: recipeRefetchMock,
  };
}

function mockBootstrap(overrides: Partial<ReturnType<typeof defaultBootstrapResult>> = {}) {
  useBootstrapQueryMock.mockReturnValue({ ...defaultBootstrapResult(), ...overrides });
}

function mockRecipe(overrides: Partial<ReturnType<typeof defaultRecipeResult>> = {}) {
  useMenuItemRecipeQueryMock.mockReturnValue({ ...defaultRecipeResult(), ...overrides });
}

function recipeForm(): HTMLElement {
  const form = screen.getByLabelText("재료").closest("form");
  if (!form) {
    throw new Error("recipe form not found");
  }
  return form;
}

function contentForm(): HTMLElement {
  return screen.getByRole("form", { name: "손님 화면 설명" });
}

function labelText(n: number): HTMLElement {
  return within(contentForm()).getByRole("textbox", { name: `라벨 ${n} 글자` });
}

function labelColor(n: number): HTMLElement {
  return within(contentForm()).getByRole("combobox", { name: `라벨 ${n} 색상` });
}

function addLabelButton(): HTMLElement {
  return within(contentForm()).getByRole("button", { name: "라벨 추가" });
}

function contentSave(): HTMLElement {
  return within(contentForm()).getByRole("button", { name: "저장" });
}

function addLabel(text: string, color?: string) {
  fireEvent.click(addLabelButton());
  const n = within(contentForm()).getAllByRole("textbox", { name: /^라벨 \d+ 글자$/ }).length;
  fireEvent.change(labelText(n), { target: { value: text } });
  if (color) {
    fireEvent.change(labelColor(n), { target: { value: color } });
  }
}

beforeEach(() => {
  updateMenuItemRecipeMutate.mockClear();
  updateMenuItemContentMutate.mockClear();
  updateMenuItemContentMutationState.current = idleMutation(updateMenuItemContentMutate);
  bootstrapRefetchMock.mockClear();
  recipeRefetchMock.mockClear();
  updateMenuItemRecipeMutationState.current = idleMutation(updateMenuItemRecipeMutate);
  mockBootstrap();
  mockRecipe();
});

afterEach(() => {
  cleanup();
});

describe("MenuItemDetailPage", () => {
  it("renders the back-to-list navigation as a button, not a plain text link", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    const back = screen.getByRole("link", { name: "메뉴 목록으로" });
    expect(back).toHaveAttribute("href", "/menu");
    expect(back).toHaveClass("border-border");
  });

  it("shows a loading state while bootstrap data is loading", () => {
    mockBootstrap({ data: undefined, isLoading: true });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action when bootstrap fails", () => {
    mockBootstrap({ data: undefined, isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(bootstrapRefetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a not-found state when no item matches the id", () => {
    render(<MenuItemDetailPage menuItemId="does-not-exist" />);

    expect(screen.getByText("메뉴를 찾을 수 없습니다.")).toBeInTheDocument();
  });

  it("shows the item's read-only basic info", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(screen.getByText("감자튀김")).toBeInTheDocument();
    expect(screen.getByText("안주")).toBeInTheDocument();
    expect(screen.getByText("5000")).toBeInTheDocument();
  });

  it("shows the POS-synced image and option details", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(screen.getByRole("img", { name: "감자튀김 상품 이미지" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/fries.png",
    );
    expect(screen.getByRole("heading", { name: "옵션" })).toBeInTheDocument();
    expect(screen.getByText("소스")).toBeInTheDocument();
    expect(screen.getByText("필수 · 1~2개 선택")).toBeInTheDocument();
    expect(screen.getByText("치즈 소스")).toBeInTheDocument();
    expect(screen.getByText("+500원")).toBeInTheDocument();
    expect(screen.getByText("수량 1~3개")).toBeInTheDocument();
  });

  it("shows a loading state while the recipe is loading", () => {
    mockRecipe({ data: undefined, isLoading: true });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("shows an error state with a working retry action when the recipe fails to load", () => {
    mockRecipe({ data: undefined, isError: true, error: new Error("레시피 오류") });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("레시피 오류");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(recipeRefetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the loaded recipe's ingredients and instructions", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(screen.getByLabelText("재료")).toHaveValue("감자 200g, 소금");
    expect(screen.getByLabelText("조리법")).toHaveValue("180도에서 5분 튀긴다");
  });

  it("saves edited ingredients and instructions", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.change(screen.getByLabelText("재료"), { target: { value: "새 재료" } });
    fireEvent.change(screen.getByLabelText("조리법"), { target: { value: "새 조리법" } });
    fireEvent.click(within(recipeForm()).getByRole("button", { name: "저장" }));

    expect(updateMenuItemRecipeMutate).toHaveBeenCalledWith(
      { ingredients: "새 재료", instructions: "새 조리법" },
      expect.anything(),
    );
  });

  it("shows a success message once the save succeeds", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.click(within(recipeForm()).getByRole("button", { name: "저장" }));

    const onSuccess = updateMenuItemRecipeMutate.mock.calls[0][1].onSuccess as (
      recipe: MenuItemRecipe,
    ) => void;
    act(() => onSuccess(RECIPE_FIXTURE));

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("disables the save button while the mutation is pending", () => {
    updateMenuItemRecipeMutationState.current = { ...idleMutation(updateMenuItemRecipeMutate), isPending: true };

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(recipeForm()).getByRole("button", { name: "저장" })).toBeDisabled();
  });
});

describe("MenuItemDetailPage customer description and labels", () => {
  function itemWith(overrides: Partial<AppData["items"][number]>): AppData {
    return { ...FIXTURE, items: [{ ...FIXTURE.items[0], ...overrides }] };
  }

  it("moves focus to the add button after a label row is removed so repeated Enter cannot delete more rows", () => {
    mockBootstrap({
      data: itemWith({
        customLabels: [
          { text: "6%", color: "blue" },
          { text: "스무디", color: "pink" },
        ],
      }),
    });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.click(within(contentForm()).getByRole("button", { name: "라벨 1 삭제" }));
    expect(within(contentForm()).getByRole("button", { name: "라벨 추가" })).toHaveFocus();
    expect(within(contentForm()).getByLabelText("라벨 1 글자")).toHaveValue("스무디");
  });

  it("prefills the override and shows the POS description as the fallback hint", () => {
    mockBootstrap({ data: itemWith({ description: "직접 쓴 설명", descriptionOverride: "직접 쓴 설명" }) });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    const textarea = within(contentForm()).getByLabelText("설명");
    expect(textarea).toHaveValue("직접 쓴 설명");
    expect(textarea).toHaveAttribute("maxLength", "300");
    expect(textarea).toHaveAttribute("placeholder", "바삭한 감자튀김");
    expect(within(contentForm()).getByText("비우면 포스 설명을 보여줘요: 바삭한 감자튀김")).toBeInTheDocument();
    expect(within(contentForm()).getByText("7/300")).toBeInTheDocument();
  });

  it("works on an old server without the new fields: empty override, no label rows, item description as POS hint", () => {
    const { posDescription: _p, descriptionOverride: _d, customLabels: _c, ...oldItem } = FIXTURE.items[0];
    mockBootstrap({ data: { ...FIXTURE, items: [oldItem] } });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(contentForm()).getByLabelText("설명")).toHaveValue("");
    expect(within(contentForm()).getByText("비우면 포스 설명을 보여줘요: 바삭한 감자튀김")).toBeInTheDocument();
    expect(within(contentForm()).queryAllByRole("textbox", { name: /^라벨 \d+ 글자$/ })).toHaveLength(0);
    expect(addLabelButton()).toBeEnabled();
  });

  it("has no link to a separate label management screen", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(screen.queryByRole("link", { name: /라벨 관리/ })).not.toBeInTheDocument();
  });

  it("seeds the label rows from the saved custom labels in order, with a preview chip each", () => {
    mockBootstrap({
      data: itemWith({
        customLabels: [
          { text: "인기", color: "pink" },
          { text: "신메뉴", color: "blue" },
        ],
      }),
    });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(labelText(1)).toHaveValue("인기");
    expect(labelText(1)).toHaveAttribute("maxLength", "20");
    expect(labelColor(1)).toHaveValue("pink");
    expect(labelText(2)).toHaveValue("신메뉴");
    expect(labelColor(2)).toHaveValue("blue");
    expect(within(contentForm()).getByText("인기", { selector: "[data-label-color]" })).toHaveAttribute(
      "data-label-color",
      "pink",
    );
    // 직접 입력한 라벨이 있으면 포스 라벨 대체 안내는 보이지 않는다.
    expect(within(contentForm()).queryByText("라벨을 입력하지 않으면 포스 설명에 적은 도수(ABV)를 라벨로 보여줘요.")).not.toBeInTheDocument();
  });

  it("adds a new row with green as the default color and a live preview", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.click(addLabelButton());
    expect(labelColor(1)).toHaveValue("green");
    expect(Array.from((labelColor(1) as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      "green",
      "amber",
      "pink",
      "blue",
    ]);

    fireEvent.change(labelText(1), { target: { value: "매운맛" } });
    fireEvent.change(labelColor(1), { target: { value: "amber" } });
    expect(within(contentForm()).getByText("매운맛", { selector: "[data-label-color]" })).toHaveAttribute(
      "data-label-color",
      "amber",
    );
  });

  it("removes a row and renumbers the rest", () => {
    mockBootstrap({
      data: itemWith({
        customLabels: [
          { text: "인기", color: "pink" },
          { text: "신메뉴", color: "blue" },
        ],
      }),
    });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.click(within(contentForm()).getByRole("button", { name: "라벨 1 삭제" }));

    expect(labelText(1)).toHaveValue("신메뉴");
    expect(labelColor(1)).toHaveValue("blue");
    expect(within(contentForm()).queryByRole("button", { name: "라벨 2 삭제" })).not.toBeInTheDocument();
  });

  it("allows at most five rows and disables adding with a hint", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(contentForm()).queryByText("라벨은 최대 5개까지 넣을 수 있어요.")).not.toBeInTheDocument();
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(addLabelButton());
    }

    expect(within(contentForm()).getAllByRole("textbox", { name: /^라벨 \d+ 글자$/ })).toHaveLength(5);
    expect(addLabelButton()).toBeDisabled();
    expect(within(contentForm()).getByText("라벨은 최대 5개까지 넣을 수 있어요.")).toBeInTheDocument();
  });

  it("keeps save disabled while nothing has changed, comparing trimmed label rows", () => {
    mockBootstrap({ data: itemWith({ customLabels: [{ text: "인기", color: "pink" }] }) });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(contentSave()).toBeDisabled();

    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "새 설명" } });
    expect(contentSave()).toBeEnabled();
    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "" } });
    expect(contentSave()).toBeDisabled();

    fireEvent.change(labelText(1), { target: { value: "  인기 " } });
    expect(contentSave()).toBeDisabled();

    fireEvent.change(labelColor(1), { target: { value: "blue" } });
    expect(contentSave()).toBeEnabled();
    fireEvent.change(labelColor(1), { target: { value: "pink" } });
    expect(contentSave()).toBeDisabled();

    fireEvent.click(addLabelButton());
    expect(contentSave()).toBeEnabled();
  });

  it("shows the POS-label fallback hint with the current Toss labels while no label is entered", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(contentForm()).getByText("라벨을 입력하지 않으면 포스 설명에 적은 도수(ABV)를 라벨로 보여줘요.")).toBeInTheDocument();
    expect(within(contentForm()).getByText("포스에서 가져온 라벨: BEST")).toBeInTheDocument();

    fireEvent.click(addLabelButton());
    expect(within(contentForm()).queryByText("라벨을 입력하지 않으면 포스 설명에 적은 도수(ABV)를 라벨로 보여줘요.")).not.toBeInTheDocument();
  });

  it("blocks saving an empty label with an inline error and sends no request", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    addLabel("   ");
    fireEvent.click(contentSave());

    expect(updateMenuItemContentMutate).not.toHaveBeenCalled();
    expect(labelText(1)).toHaveAttribute("aria-invalid", "true");
    expect(labelText(1)).toHaveAccessibleDescription("라벨 글자를 입력하세요.");

    // 고치면 오류가 사라지고 저장된다.
    fireEvent.change(labelText(1), { target: { value: "인기" } });
    expect(labelText(1)).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.click(contentSave());
    expect(updateMenuItemContentMutate).toHaveBeenCalledTimes(1);
  });

  it("blocks saving duplicate label texts (case-insensitive, trimmed) with an inline error", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    addLabel("Best");
    addLabel(" best ", "pink");
    fireEvent.click(contentSave());

    expect(updateMenuItemContentMutate).not.toHaveBeenCalled();
    expect(labelText(1)).not.toHaveAttribute("aria-invalid", "true");
    expect(labelText(2)).toHaveAttribute("aria-invalid", "true");
    expect(labelText(2)).toHaveAccessibleDescription("같은 라벨이 이미 있어요.");
  });

  it("saves the override and trimmed labels in input order, then reseeds from the response", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "겉바속촉" } });
    addLabel(" 인기 ", "pink");
    addLabel("신메뉴");
    fireEvent.click(contentSave());

    expect(updateMenuItemContentMutate).toHaveBeenCalledWith(
      {
        descriptionOverride: "겉바속촉",
        labels: [
          { text: "인기", color: "pink" },
          { text: "신메뉴", color: "green" },
        ],
      },
      expect.anything(),
    );

    const saved = itemWith({
      description: "겉바속촉",
      descriptionOverride: "겉바속촉",
      customLabels: [
        { text: "인기", color: "pink" },
        { text: "신메뉴", color: "green" },
      ],
    });
    const onSuccess = updateMenuItemContentMutate.mock.calls[0][1].onSuccess as (data: AppData) => void;
    mockBootstrap({ data: saved });
    act(() => onSuccess(saved));

    expect(screen.getByRole("status")).toHaveTextContent("손님 화면 설명을 저장했어요.");
    expect(labelText(1)).toHaveValue("인기");
    expect(contentSave()).toBeDisabled();
  });

  it("saves an empty label list after removing every row", () => {
    mockBootstrap({ data: itemWith({ customLabels: [{ text: "인기", color: "pink" }] }) });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.click(within(contentForm()).getByRole("button", { name: "라벨 1 삭제" }));
    fireEvent.click(contentSave());

    expect(updateMenuItemContentMutate).toHaveBeenCalledWith(
      { descriptionOverride: "", labels: [] },
      expect.anything(),
    );
  });

  it("keeps the typed input and shows the error when saving fails", () => {
    const { rerender } = render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "실패할 설명" } });
    addLabel("인기", "blue");
    fireEvent.click(contentSave());

    updateMenuItemContentMutationState.current = {
      ...idleMutation(updateMenuItemContentMutate),
      isError: true,
      error: new Error("label text too long"),
    };
    rerender(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(contentForm()).getByRole("alert")).toHaveTextContent("label text too long");
    expect(within(contentForm()).getByLabelText("설명")).toHaveValue("실패할 설명");
    expect(labelText(1)).toHaveValue("인기");
    expect(labelColor(1)).toHaveValue("blue");
  });

  it("disables save while the content mutation is pending", () => {
    updateMenuItemContentMutationState.current = { ...idleMutation(updateMenuItemContentMutate), isPending: true };

    render(<MenuItemDetailPage menuItemId="menu-1" />);
    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "새 설명" } });

    expect(contentSave()).toBeDisabled();
  });
});
