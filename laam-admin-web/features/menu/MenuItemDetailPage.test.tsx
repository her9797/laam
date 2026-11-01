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
      labelIds: [],
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
  menuLabels: [
    { id: "label-1", text: "신메뉴", color: "green", sortOrder: 0 },
    { id: "label-2", text: "인기", color: "pink", sortOrder: 1 },
    { id: "label-3", text: "매운맛", color: "amber", sortOrder: 2 },
    { id: "label-4", text: "추천", color: "blue", sortOrder: 3 },
    { id: "label-5", text: "한정", color: "green", sortOrder: 4 },
    { id: "label-6", text: "비건", color: "green", sortOrder: 5 },
  ],
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

function labelToggle(text: string): HTMLElement {
  return within(contentForm()).getByRole("button", { name: text });
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

  it("falls back to the item description as the POS hint on an old server without the new fields", () => {
    const { posDescription: _p, descriptionOverride: _d, labelIds: _l, ...oldItem } = FIXTURE.items[0];
    const { menuLabels: _m, ...oldData } = FIXTURE;
    mockBootstrap({ data: { ...oldData, items: [oldItem] } });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(contentForm()).getByLabelText("설명")).toHaveValue("");
    expect(within(contentForm()).getByText("비우면 포스 설명을 보여줘요: 바삭한 감자튀김")).toBeInTheDocument();
    expect(within(contentForm()).getByRole("link", { name: "라벨 관리로 이동" })).toHaveAttribute(
      "href",
      "/menu/labels",
    );
  });

  it("keeps save disabled while nothing has changed", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(contentForm()).getByRole("button", { name: "저장" })).toBeDisabled();

    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "새 설명" } });
    expect(within(contentForm()).getByRole("button", { name: "저장" })).toBeEnabled();

    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "" } });
    expect(within(contentForm()).getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("shows the POS-label fallback hint with the current Toss labels while none are picked", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(contentForm()).getByText("고르지 않으면 포스 라벨을 보여줘요.")).toBeInTheDocument();
    expect(within(contentForm()).getByText("현재 포스 라벨: BEST")).toBeInTheDocument();
  });

  it("saves the override and labels in selection order, then shows a success message", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "겉바속촉" } });
    fireEvent.click(labelToggle("인기"));
    fireEvent.click(labelToggle("신메뉴"));
    expect(labelToggle("인기")).toHaveAttribute("aria-pressed", "true");
    expect(within(contentForm()).queryByText("고르지 않으면 포스 라벨을 보여줘요.")).not.toBeInTheDocument();
    fireEvent.click(within(contentForm()).getByRole("button", { name: "저장" }));

    expect(updateMenuItemContentMutate).toHaveBeenCalledWith(
      { descriptionOverride: "겉바속촉", labelIds: ["label-2", "label-1"] },
      expect.anything(),
    );

    const saved = itemWith({
      description: "겉바속촉",
      descriptionOverride: "겉바속촉",
      labelIds: ["label-2", "label-1"],
    });
    const onSuccess = updateMenuItemContentMutate.mock.calls[0][1].onSuccess as (data: AppData) => void;
    mockBootstrap({ data: saved });
    act(() => onSuccess(saved));

    expect(screen.getByRole("status")).toHaveTextContent("손님 화면 설명을 저장했어요.");
    expect(within(contentForm()).getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("deselects a picked label when it is clicked again", () => {
    mockBootstrap({ data: itemWith({ labelIds: ["label-1"] }) });

    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(labelToggle("신메뉴")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(labelToggle("신메뉴"));
    expect(labelToggle("신메뉴")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(contentForm()).getByRole("button", { name: "저장" }));

    expect(updateMenuItemContentMutate).toHaveBeenCalledWith(
      { descriptionOverride: "", labelIds: [] },
      expect.anything(),
    );
  });

  it("allows at most five labels and disables the rest with a hint", () => {
    render(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(contentForm()).queryByText("라벨은 최대 5개까지 고를 수 있어요.")).not.toBeInTheDocument();
    for (const text of ["신메뉴", "인기", "매운맛", "추천", "한정"]) {
      fireEvent.click(labelToggle(text));
    }

    expect(labelToggle("비건")).toBeDisabled();
    expect(labelToggle("신메뉴")).toBeEnabled();
    expect(within(contentForm()).getByText("라벨은 최대 5개까지 고를 수 있어요.")).toBeInTheDocument();
  });

  it("keeps the typed input and shows the error when saving fails", () => {
    const { rerender } = render(<MenuItemDetailPage menuItemId="menu-1" />);

    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "실패할 설명" } });
    fireEvent.click(within(contentForm()).getByRole("button", { name: "저장" }));

    updateMenuItemContentMutationState.current = {
      ...idleMutation(updateMenuItemContentMutate),
      isError: true,
      error: new Error("unknown label id"),
    };
    rerender(<MenuItemDetailPage menuItemId="menu-1" />);

    expect(within(contentForm()).getByRole("alert")).toHaveTextContent("unknown label id");
    expect(within(contentForm()).getByLabelText("설명")).toHaveValue("실패할 설명");
  });

  it("disables save while the content mutation is pending", () => {
    updateMenuItemContentMutationState.current = { ...idleMutation(updateMenuItemContentMutate), isPending: true };

    render(<MenuItemDetailPage menuItemId="menu-1" />);
    fireEvent.change(within(contentForm()).getByLabelText("설명"), { target: { value: "새 설명" } });

    expect(within(contentForm()).getByRole("button", { name: "저장" })).toBeDisabled();
  });
});
