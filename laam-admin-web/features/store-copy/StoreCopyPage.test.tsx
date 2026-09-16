import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "@/features/bootstrap/model";

const useBootstrapQueryMock = vi.fn();

vi.mock("@/features/bootstrap/queries", () => ({
  useBootstrapQuery: () => useBootstrapQueryMock(),
}));

const updateStoreCopiesMutate = vi.fn();

function idleMutation(mutate: ReturnType<typeof vi.fn>) {
  return { mutate, isPending: false, isError: false, error: null as unknown };
}

const updateStoreCopiesMutationState = { current: idleMutation(updateStoreCopiesMutate) };

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    useUpdateStoreCopiesMutation: () => updateStoreCopiesMutationState.current,
  };
});

import { StoreCopyPage } from "./StoreCopyPage";

const FIXTURE: AppData = {
  store: {
    name: "가게",
    subtitle: "",
    address: "",
    songRequestCopy: "노래 신청은 QR로 해주세요.",
    requestCopy: "요청은 자유롭게 남겨주세요.",
    eventCopy: "매주 이벤트가 진행됩니다.",
  },
  categories: [],
  items: [],
  requestGuides: [],
  notices: [],
};

const refetchMock = vi.fn();

function defaultBootstrapResult() {
  return {
    data: FIXTURE,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: refetchMock,
  };
}

function mockBootstrap(overrides: Partial<ReturnType<typeof defaultBootstrapResult>> = {}) {
  useBootstrapQueryMock.mockReturnValue({ ...defaultBootstrapResult(), ...overrides });
}

beforeEach(() => {
  updateStoreCopiesMutate.mockClear();
  refetchMock.mockClear();
  updateStoreCopiesMutationState.current = idleMutation(updateStoreCopiesMutate);
  mockBootstrap();
});

afterEach(() => {
  cleanup();
});

describe("StoreCopyPage", () => {
  it("shows a loading state while bootstrap data is loading", () => {
    mockBootstrap({ data: undefined, isLoading: true });

    render(<StoreCopyPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action when the query fails", () => {
    mockBootstrap({
      data: undefined,
      isError: true,
      error: new Error("요청이 실패했습니다. (500)"),
    });

    render(<StoreCopyPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the original values from the bootstrap store data in the three textareas", () => {
    render(<StoreCopyPage />);

    expect(screen.getByLabelText("노래 신청 안내")).toHaveValue("노래 신청은 QR로 해주세요.");
    expect(screen.getByLabelText("요청 안내")).toHaveValue("요청은 자유롭게 남겨주세요.");
    expect(screen.getByLabelText("이벤트 안내")).toHaveValue("매주 이벤트가 진행됩니다.");
  });

  it("submits the full three-field payload even when only one field changed", () => {
    render(<StoreCopyPage />);

    fireEvent.change(screen.getByLabelText("이벤트 안내"), {
      target: { value: "새로운 이벤트 안내" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(updateStoreCopiesMutate).toHaveBeenCalledWith(
      {
        songRequestCopy: "노래 신청은 QR로 해주세요.",
        requestCopy: "요청은 자유롭게 남겨주세요.",
        eventCopy: "새로운 이벤트 안내",
      },
      expect.anything(),
    );
  });

  it("shows a success message and syncs to the server response once the save succeeds", () => {
    render(<StoreCopyPage />);

    fireEvent.change(screen.getByLabelText("이벤트 안내"), {
      target: { value: "새로운 이벤트 안내" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const onSuccess = updateStoreCopiesMutate.mock.calls[0][1].onSuccess as (data: AppData) => void;
    act(() =>
      onSuccess({
        ...FIXTURE,
        store: { ...FIXTURE.store, eventCopy: "새로운 이벤트 안내" },
      }),
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByLabelText("이벤트 안내")).toHaveValue("새로운 이벤트 안내");
  });

  it("keeps the operator's edited values instead of reverting them when the save fails", () => {
    // The mutation's `mutationFn` is not invoked in this mocked setup — only
    // `onSuccess` (called explicitly in other tests) writes the server
    // response back into the form. Clicking save without ever calling
    // `onSuccess` simulates a failed (or still in-flight) save: the page
    // must not have any `onError`/reset path that reverts the textarea to
    // the last-loaded bootstrap value.
    render(<StoreCopyPage />);

    fireEvent.change(screen.getByLabelText("이벤트 안내"), {
      target: { value: "저장 실패할 값" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(updateStoreCopiesMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("이벤트 안내")).toHaveValue("저장 실패할 값");
    expect(screen.getByLabelText("노래 신청 안내")).toHaveValue("노래 신청은 QR로 해주세요.");
  });

  it("disables the save button while the mutation is pending", () => {
    updateStoreCopiesMutationState.current = {
      ...idleMutation(updateStoreCopiesMutate),
      isPending: true,
    };

    render(<StoreCopyPage />);

    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });
});
