import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FetchJsonError } from "@/lib/api/fetch-json";

import type { CatalogSyncResponse } from "./model";

const mutateMock = vi.fn();
const useResyncCatalogMutationMock = vi.fn();

vi.mock("./queries", () => ({
  useResyncCatalogMutation: () => useResyncCatalogMutationMock(),
}));

const toastAddMock = vi.fn();
vi.mock("@/components/ui/toast", () => ({ toast: { add: (...args: unknown[]) => toastAddMock(...args) } }));

import { CatalogResyncButton } from "./CatalogResyncButton";

const RESPONSE: CatalogSyncResponse = {
  created: 2,
  linked: 1,
  updated: 3,
  data: { store: {} as never, categories: [], items: [], requestGuides: [], notices: [] },
};

function mockMutation(overrides: Partial<ReturnType<typeof defaultMutationResult>> = {}) {
  useResyncCatalogMutationMock.mockReturnValue({ ...defaultMutationResult(), ...overrides });
}

function defaultMutationResult() {
  return { mutate: mutateMock, isPending: false };
}

describe("CatalogResyncButton", () => {
  beforeEach(() => {
    mutateMock.mockClear();
    toastAddMock.mockClear();
    useResyncCatalogMutationMock.mockClear();
    mockMutation();
  });

  afterEach(() => {
    cleanup();
  });

  it("triggers the mutation when clicked", () => {
    render(<CatalogResyncButton />);

    fireEvent.click(screen.getByRole("button"));

    expect(mutateMock).toHaveBeenCalledTimes(1);
  });

  it("disables the button while the mutation is pending", () => {
    mockMutation({ isPending: true });

    render(<CatalogResyncButton />);

    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows a success toast with the sync counts", () => {
    render(<CatalogResyncButton />);

    fireEvent.click(screen.getByRole("button"));
    const options = mutateMock.mock.calls[0][1] as { onSuccess: (r: CatalogSyncResponse) => void };
    options.onSuccess(RESPONSE);

    expect(toastAddMock).toHaveBeenCalledTimes(1);
    const [call] = toastAddMock.mock.calls[0];
    expect(call.description).toContain("2");
    expect(call.description).toContain("1");
    expect(call.description).toContain("3");
  });

  it("shows a distinct toast when a sync is already in progress (409)", () => {
    render(<CatalogResyncButton />);

    fireEvent.click(screen.getByRole("button"));
    const options = mutateMock.mock.calls[0][1] as { onError: (e: unknown) => void };
    options.onError(new FetchJsonError(409, "catalog sync already in progress"));

    expect(toastAddMock).toHaveBeenCalledTimes(1);
    expect(toastAddMock.mock.calls[0][0].title).toBe("이미 동기화가 진행 중입니다.");
  });

  it("shows a distinct toast when Toss Place isn't configured (503)", () => {
    render(<CatalogResyncButton />);

    fireEvent.click(screen.getByRole("button"));
    const options = mutateMock.mock.calls[0][1] as { onError: (e: unknown) => void };
    options.onError(new FetchJsonError(503, "toss place catalog sync is not configured"));

    expect(toastAddMock).toHaveBeenCalledTimes(1);
    expect(toastAddMock.mock.calls[0][0].title).toBe("POS 연동이 설정되어 있지 않습니다.");
  });

  it("falls back to the server's own error message for any other failure", () => {
    render(<CatalogResyncButton />);

    fireEvent.click(screen.getByRole("button"));
    const options = mutateMock.mock.calls[0][1] as { onError: (e: unknown) => void };
    options.onError(new FetchJsonError(502, "toss place unreachable"));

    expect(toastAddMock).toHaveBeenCalledTimes(1);
    expect(toastAddMock.mock.calls[0][0].description).toBe("toss place unreachable");
  });
});
