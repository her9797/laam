import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "@/features/bootstrap/model";
import { FetchJsonError } from "@/lib/api/fetch-json";

const useBootstrapQueryMock = vi.fn();

vi.mock("@/features/bootstrap/queries", () => ({
  useBootstrapQuery: () => useBootstrapQueryMock(),
}));

const createMenuLabelMutate = vi.fn();
const updateMenuLabelMutate = vi.fn();
const deleteMenuLabelMutate = vi.fn();
const deleteMenuLabelReset = vi.fn();

function idleMutation(mutate: ReturnType<typeof vi.fn>) {
  return { mutate, reset: deleteMenuLabelReset, isPending: false, isError: false, error: null as unknown, variables: undefined as unknown };
}

const createMenuLabelMutationState = { current: idleMutation(createMenuLabelMutate) };
const updateMenuLabelMutationState = { current: idleMutation(updateMenuLabelMutate) };
const deleteMenuLabelMutationState = { current: idleMutation(deleteMenuLabelMutate) };

vi.mock("./queries", () => ({
  useCreateMenuLabelMutation: () => createMenuLabelMutationState.current,
  useUpdateMenuLabelMutation: () => updateMenuLabelMutationState.current,
  useDeleteMenuLabelMutation: () => deleteMenuLabelMutationState.current,
}));

import { MenuLabelManagementPage } from "./MenuLabelManagementPage";

const FIXTURE: AppData = {
  store: { name: "가게", subtitle: "", address: "", songRequestCopy: "", requestCopy: "", eventCopy: "" },
  categories: [],
  items: [],
  requestGuides: [],
  notices: [],
  menuLabels: [
    { id: "label-1", text: "신메뉴", color: "green", sortOrder: 0 },
    { id: "label-2", text: "인기", color: "pink", sortOrder: 1 },
  ],
};

const refetchMock = vi.fn();

function mockBootstrap(overrides: Record<string, unknown> = {}) {
  useBootstrapQueryMock.mockReturnValue({
    data: FIXTURE,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: refetchMock,
    ...overrides,
  });
}

function labelRow(text: string): HTMLElement {
  const row = screen.getByLabelText(`'${text}' 라벨 이름`).closest("tr");
  if (!row) {
    throw new Error(`row for ${text} not found`);
  }
  return row;
}

beforeEach(() => {
  createMenuLabelMutate.mockClear();
  updateMenuLabelMutate.mockClear();
  deleteMenuLabelMutate.mockClear();
  refetchMock.mockClear();
  createMenuLabelMutationState.current = idleMutation(createMenuLabelMutate);
  updateMenuLabelMutationState.current = idleMutation(updateMenuLabelMutate);
  deleteMenuLabelMutationState.current = idleMutation(deleteMenuLabelMutate);
  mockBootstrap();
});

afterEach(() => {
  cleanup();
});

describe("MenuLabelManagementPage", () => {
  it("shows a loading state while bootstrap data is loading", () => {
    mockBootstrap({ data: undefined, isLoading: true });

    render(<MenuLabelManagementPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action", () => {
    mockBootstrap({ data: undefined, isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<MenuLabelManagementPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when there are no labels, including an old server without menuLabels", () => {
    const { menuLabels: _omitted, ...withoutLabels } = FIXTURE;
    mockBootstrap({ data: withoutLabels });

    render(<MenuLabelManagementPage />);

    expect(screen.getByRole("heading", { name: "라벨 관리" })).toBeInTheDocument();
    expect(screen.getByText("등록된 라벨이 없어요.")).toBeInTheDocument();
  });

  it("lists every label with its name, color and a colored preview chip", () => {
    render(<MenuLabelManagementPage />);

    expect(screen.getByLabelText("'신메뉴' 라벨 이름")).toHaveValue("신메뉴");
    expect(screen.getByLabelText("'신메뉴' 라벨 색상")).toHaveValue("green");
    expect(screen.getByLabelText("'인기' 라벨 색상")).toHaveValue("pink");
    const chip = within(labelRow("인기")).getByText("인기", { selector: "[data-label-color]" });
    expect(chip).toHaveAttribute("data-label-color", "pink");
  });

  it("creates a label with the trimmed name and chosen color, then clears the form", () => {
    render(<MenuLabelManagementPage />);

    const form = screen.getByRole("form", { name: "라벨 추가" });
    fireEvent.change(within(form).getByLabelText("라벨 이름"), { target: { value: "  매운맛 " } });
    fireEvent.change(within(form).getByLabelText("라벨 색상"), { target: { value: "amber" } });
    fireEvent.click(within(form).getByRole("button", { name: "라벨 추가" }));

    expect(createMenuLabelMutate).toHaveBeenCalledWith({ text: "매운맛", color: "amber" }, expect.anything());

    const onSuccess = createMenuLabelMutate.mock.calls[0][1].onSuccess as () => void;
    act(() => onSuccess());
    expect(within(form).getByLabelText("라벨 이름")).toHaveValue("");
  });

  it("does not submit a blank label name", () => {
    render(<MenuLabelManagementPage />);

    const form = screen.getByRole("form", { name: "라벨 추가" });
    fireEvent.change(within(form).getByLabelText("라벨 이름"), { target: { value: "   " } });
    fireEvent.click(within(form).getByRole("button", { name: "라벨 추가" }));

    expect(createMenuLabelMutate).not.toHaveBeenCalled();
    expect(within(form).getByRole("alert")).toHaveTextContent("라벨 이름을 입력하세요.");
  });

  it("limits the label name input to 20 characters", () => {
    render(<MenuLabelManagementPage />);

    const form = screen.getByRole("form", { name: "라벨 추가" });
    expect(within(form).getByLabelText("라벨 이름")).toHaveAttribute("maxLength", "20");
  });

  it("shows the duplicate-name message when the server answers 409 on create", () => {
    createMenuLabelMutationState.current = {
      ...idleMutation(createMenuLabelMutate),
      isError: true,
      error: new FetchJsonError(409, "label already exists"),
    };

    render(<MenuLabelManagementPage />);

    const form = screen.getByRole("form", { name: "라벨 추가" });
    expect(within(form).getByRole("alert")).toHaveTextContent("같은 이름의 라벨이 있어요.");
  });

  it("shows the server's own message for other create failures", () => {
    createMenuLabelMutationState.current = {
      ...idleMutation(createMenuLabelMutate),
      isError: true,
      error: new FetchJsonError(400, "invalid color"),
    };

    render(<MenuLabelManagementPage />);

    const form = screen.getByRole("form", { name: "라벨 추가" });
    expect(within(form).getByRole("alert")).toHaveTextContent("invalid color");
  });

  it("keeps a row's save disabled until its name or color changes, then saves the edit", () => {
    render(<MenuLabelManagementPage />);

    const row = labelRow("신메뉴");
    const save = within(row).getByRole("button", { name: "저장" });
    expect(save).toBeDisabled();

    fireEvent.change(within(row).getByLabelText("'신메뉴' 라벨 이름"), { target: { value: "신상" } });
    fireEvent.change(within(row).getByLabelText("'신메뉴' 라벨 색상"), { target: { value: "blue" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    expect(updateMenuLabelMutate).toHaveBeenCalledWith(
      { id: "label-1", input: { text: "신상", color: "blue" } },
      expect.anything(),
    );
  });

  it("shows the duplicate-name message in the row when an edit answers 409", () => {
    updateMenuLabelMutationState.current = {
      ...idleMutation(updateMenuLabelMutate),
      isError: true,
      error: new FetchJsonError(409, "label already exists"),
      variables: { id: "label-2", input: { text: "신메뉴", color: "pink" } },
    };

    render(<MenuLabelManagementPage />);

    expect(within(labelRow("인기")).getByRole("alert")).toHaveTextContent("같은 이름의 라벨이 있어요.");
    expect(within(labelRow("신메뉴")).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks for confirmation (mentioning menus lose the label) before deleting", () => {
    render(<MenuLabelManagementPage />);

    fireEvent.click(within(labelRow("인기")).getByRole("button", { name: "삭제" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("이 라벨을 붙인 메뉴에서도 빠져요.");
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(deleteMenuLabelMutate).not.toHaveBeenCalled();

    fireEvent.click(within(labelRow("인기")).getByRole("button", { name: "삭제" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "삭제" }));
    expect(deleteMenuLabelMutate).toHaveBeenCalledWith("label-2", expect.anything());

    const onSuccess = deleteMenuLabelMutate.mock.calls[0][1].onSuccess as () => void;
    act(() => onSuccess());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("clears a previous delete error whenever the confirm dialog is opened", () => {
    deleteMenuLabelReset.mockClear();
    render(<MenuLabelManagementPage />);

    fireEvent.click(within(labelRow("인기")).getByRole("button", { name: "삭제" }));
    expect(deleteMenuLabelReset).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed delete inside the still-open confirm dialog", () => {
    deleteMenuLabelMutationState.current = {
      ...idleMutation(deleteMenuLabelMutate),
      isError: true,
      error: new FetchJsonError(404, "label not found"),
    };

    render(<MenuLabelManagementPage />);

    fireEvent.click(within(labelRow("인기")).getByRole("button", { name: "삭제" }));
    expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent("label not found");
  });
});
