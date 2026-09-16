import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateCategoryForm } from "./model";

const replaceMock = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/menu/categories",
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => currentSearchParams,
}));

const useBootstrapQueryMock = vi.fn();

vi.mock("@/features/bootstrap/queries", () => ({
  useBootstrapQuery: () => useBootstrapQueryMock(),
}));

const createCategoryMutate = vi.fn();
const updateCategoryVisibilityMutate = vi.fn();
const deleteCategoryMutate = vi.fn();
const resyncCatalogMutate = vi.fn();

function idleMutation(mutate: ReturnType<typeof vi.fn>) {
  return { mutate, isPending: false, isError: false, error: null as unknown, variables: undefined as unknown };
}

const createCategoryMutationState = { current: idleMutation(createCategoryMutate) };
const updateCategoryVisibilityMutationState = { current: idleMutation(updateCategoryVisibilityMutate) };
const deleteCategoryMutationState = { current: idleMutation(deleteCategoryMutate) };
// CatalogResyncButton (rendered inside CategoryPanel) reads this too — not
// under test here, just needs a non-throwing default so this page's own
// tests keep exercising category create/update/delete only.
const resyncCatalogMutationState = { current: idleMutation(resyncCatalogMutate) };

vi.mock("./queries", () => ({
  useCreateCategoryMutation: () => createCategoryMutationState.current,
  useUpdateCategoryVisibilityMutation: () => updateCategoryVisibilityMutationState.current,
  useDeleteCategoryMutation: () => deleteCategoryMutationState.current,
  useResyncCatalogMutation: () => resyncCatalogMutationState.current,
}));

import { CategoryManagementPage } from "./CategoryManagementPage";

const FIXTURE = {
  store: {
    name: "가게",
    subtitle: "",
    address: "",
    songRequestCopy: "",
    requestCopy: "",
    eventCopy: "",
  },
  categories: [{ id: "drinks", label: "음료", isVisible: true }],
  items: [],
  requestGuides: [],
  notices: [],
};

function defaultBootstrapResult() {
  return {
    data: FIXTURE,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: refetchMock,
  };
}

const refetchMock = vi.fn();

function mockBootstrap(overrides: Partial<ReturnType<typeof defaultBootstrapResult>> = {}) {
  useBootstrapQueryMock.mockReturnValue({ ...defaultBootstrapResult(), ...overrides });
}

beforeEach(() => {
  createCategoryMutate.mockClear();
  updateCategoryVisibilityMutate.mockClear();
  deleteCategoryMutate.mockClear();
  refetchMock.mockClear();
  replaceMock.mockClear();
  currentSearchParams = new URLSearchParams();

  createCategoryMutationState.current = idleMutation(createCategoryMutate);
  updateCategoryVisibilityMutationState.current = idleMutation(updateCategoryVisibilityMutate);
  deleteCategoryMutationState.current = idleMutation(deleteCategoryMutate);

  mockBootstrap();
});

afterEach(() => {
  cleanup();
});

describe("pure validators", () => {
  it("rejects an empty category id and label", () => {
    const errors = validateCategoryForm({ id: "", label: "" }, []);
    expect(errors.id).toBeTruthy();
    expect(errors.label).toBeTruthy();
  });

  it("rejects a category id that already exists", () => {
    const errors = validateCategoryForm({ id: "drinks", label: "새 이름" }, ["drinks"]);
    expect(errors.id).toBeTruthy();
  });
});

describe("CategoryManagementPage", () => {
  it("shows a loading state while bootstrap data is loading", () => {
    mockBootstrap({ data: undefined, isLoading: true });

    render(<CategoryManagementPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action when the query fails", () => {
    mockBootstrap({
      data: undefined,
      isError: true,
      error: new Error("요청이 실패했습니다. (500)"),
    });

    render(<CategoryManagementPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the page title and an empty state when there are no categories", () => {
    mockBootstrap({ data: { ...FIXTURE, categories: [] } });

    render(<CategoryManagementPage />);

    expect(screen.getByRole("heading", { name: "카테고리 관리" })).toBeInTheDocument();
    expect(screen.getByText("등록된 카테고리가 없습니다.")).toBeInTheDocument();
  });

  it("shows the total count as 0 instead of hiding it when there are no categories", () => {
    mockBootstrap({ data: { ...FIXTURE, categories: [] } });

    render(<CategoryManagementPage />);

    expect(screen.getByText("총 0건")).toBeInTheDocument();
  });

  it("keeps the total count out of the title row regardless of header action buttons", () => {
    render(<CategoryManagementPage />);

    const heading = screen.getByRole("heading", { name: "카테고리 관리" });
    expect(within(heading.parentElement as HTMLElement).queryByText("총 1건")).not.toBeInTheDocument();
    expect(screen.getByText("총 1건")).toBeInTheDocument();
  });

  it("renders the catalog resync button alongside the category form trigger", () => {
    render(<CategoryManagementPage />);

    expect(screen.getByRole("button", { name: "다시 동기화" })).toBeInTheDocument();
  });

  it("opens the category dialog from the trigger button, and closes it on cancel", () => {
    render(<CategoryManagementPage />);

    expect(screen.queryByRole("dialog", { name: "카테고리 추가" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
    const dialog = screen.getByRole("dialog", { name: "카테고리 추가" });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "카테고리 추가" })).not.toBeInTheDocument();
  });

  it("shows a field error and does not submit when the category form is left empty", () => {
    render(<CategoryManagementPage />);

    fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
    const dialog = screen.getByRole("dialog", { name: "카테고리 추가" });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

    expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0);
    expect(createCategoryMutate).not.toHaveBeenCalled();
  });

  it("creates a category with the entered fields and closes the dialog", () => {
    render(<CategoryManagementPage />);

    fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
    const dialog = screen.getByRole("dialog", { name: "카테고리 추가" });
    fireEvent.change(within(dialog).getByLabelText("카테고리 ID"), { target: { value: "food" } });
    fireEvent.change(within(dialog).getByLabelText("카테고리 이름"), { target: { value: "음식" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

    expect(createCategoryMutate).toHaveBeenCalledWith(
      { id: "food", label: "음식", isVisible: true },
      expect.anything(),
    );

    const onSuccess = createCategoryMutate.mock.calls[0][1].onSuccess as () => void;
    act(() => onSuccess());
    expect(screen.queryByRole("dialog", { name: "카테고리 추가" })).not.toBeInTheDocument();
  });

  it("rejects a category id that already exists", () => {
    render(<CategoryManagementPage />);

    fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
    const dialog = screen.getByRole("dialog", { name: "카테고리 추가" });
    fireEvent.change(within(dialog).getByLabelText("카테고리 ID"), { target: { value: "drinks" } });
    fireEvent.change(within(dialog).getByLabelText("카테고리 이름"), { target: { value: "음료 2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

    expect(within(dialog).getByText("이미 존재하는 카테고리 ID입니다.")).toBeInTheDocument();
    expect(createCategoryMutate).not.toHaveBeenCalled();
  });

  it("toggles category visibility", () => {
    render(<CategoryManagementPage />);

    const categoryRow = screen.getByText("drinks").closest("tr");
    if (!categoryRow) {
      throw new Error("category row not found");
    }
    fireEvent.click(within(categoryRow).getByRole("button", { name: "공개" }));

    expect(updateCategoryVisibilityMutate).toHaveBeenCalledWith({ id: "drinks", isVisible: false });
  });

  it("asks for confirmation before deleting a category, and only mutates after confirming", () => {
    render(<CategoryManagementPage />);

    const categoryRow = screen.getByText("drinks").closest("tr");
    if (!categoryRow) {
      throw new Error("category row not found");
    }

    fireEvent.click(within(categoryRow).getByRole("button", { name: "삭제" }));
    const confirmDialog = screen.getByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "취소" }));
    expect(deleteCategoryMutate).not.toHaveBeenCalled();

    fireEvent.click(within(categoryRow).getByRole("button", { name: "삭제" }));
    const reopenedDialog = screen.getByRole("alertdialog");
    fireEvent.click(within(reopenedDialog).getByRole("button", { name: "삭제" }));

    expect(deleteCategoryMutate).toHaveBeenCalledWith("drinks", expect.anything());
    // Stays open until the mutation's own onSuccess fires.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    const onSuccess = deleteCategoryMutate.mock.calls[0][1].onSuccess as () => void;
    act(() => onSuccess());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("surfaces a failed category delete inside the still-open confirm dialog", () => {
    deleteCategoryMutationState.current = {
      ...idleMutation(deleteCategoryMutate),
      isError: true,
      error: new Error("카테고리를 삭제할 수 없습니다. (409)"),
    };

    render(<CategoryManagementPage />);

    const categoryRow = screen.getByText("drinks").closest("tr");
    if (!categoryRow) {
      throw new Error("category row not found");
    }
    fireEvent.click(within(categoryRow).getByRole("button", { name: "삭제" }));

    const confirmDialog = screen.getByRole("alertdialog");
    expect(within(confirmDialog).getByRole("alert")).toHaveTextContent(
      "카테고리를 삭제할 수 없습니다. (409)",
    );
  });

  it("debounces a typed search into the URL", async () => {
    vi.useFakeTimers();
    mockBootstrap({
      data: {
        ...FIXTURE,
        categories: [
          { id: "drinks", label: "음료", isVisible: true },
          { id: "snacks", label: "안주", isVisible: true },
        ],
      },
    });

    render(<CategoryManagementPage />);

    fireEvent.change(screen.getByPlaceholderText("카테고리 이름으로 검색"), {
      target: { value: "안주" },
    });
    expect(replaceMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replaceMock).toHaveBeenCalledWith("/menu/categories?q=%EC%95%88%EC%A3%BC");
    vi.useRealTimers();
  });

  it("shows only categories matching a q param already in the URL, without affecting the create form's duplicate-id check", () => {
    currentSearchParams = new URLSearchParams("q=안주");
    mockBootstrap({
      data: {
        ...FIXTURE,
        categories: [
          { id: "drinks", label: "음료", isVisible: true },
          { id: "snacks", label: "안주", isVisible: true },
        ],
      },
    });

    render(<CategoryManagementPage />);

    expect(screen.getByText("안주")).toBeInTheDocument();
    expect(screen.queryByText("음료")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
    fireEvent.change(screen.getByLabelText("카테고리 ID"), { target: { value: "drinks" } });
    fireEvent.change(screen.getByLabelText("카테고리 이름"), { target: { value: "새 이름" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    // Duplicate-id validation must still see "drinks", even though the
    // table's own search filter currently hides that row.
    expect(screen.getByText("이미 존재하는 카테고리 ID입니다.")).toBeInTheDocument();
  });
});
