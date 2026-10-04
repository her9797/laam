import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SecretCoupon } from "./model";
import { validateRewardLabel } from "./model";

const useSecretCouponsQueryMock = vi.fn();
const updateMutate = vi.fn();
const redeemMutate = vi.fn();
const resetMutate = vi.fn();
const refetchMock = vi.fn();

function idleMutation(mutate: ReturnType<typeof vi.fn>) {
  return { mutate, isPending: false, variables: undefined as unknown };
}

vi.mock("./queries", () => ({
  useSecretCouponsQuery: () => useSecretCouponsQueryMock(),
  useUpdateSecretCouponLabelMutation: () => idleMutation(updateMutate),
  useRedeemSecretCouponMutation: () => idleMutation(redeemMutate),
  useResetSecretCouponMutation: () => idleMutation(resetMutate),
}));

import { CouponManagementPage } from "./CouponManagementPage";

const COUPONS: SecretCoupon[] = [
  { id: "c1", rewardLabel: "하이볼 1잔", sortOrder: 1, claimedAt: null, tableNumber: "", redeemedAt: null },
  {
    id: "c2",
    rewardLabel: "안주 1개",
    sortOrder: 2,
    claimedAt: "2026-10-03T10:00:00Z",
    tableNumber: "T-03",
    redeemedAt: null,
  },
  {
    id: "c3",
    rewardLabel: "맥주 1병",
    sortOrder: 3,
    claimedAt: "2026-10-03T11:00:00Z",
    tableNumber: "B-01",
    redeemedAt: "2026-10-03T12:00:00Z",
  },
];

function mockQuery(overrides: Record<string, unknown> = {}) {
  useSecretCouponsQueryMock.mockReturnValue({
    data: COUPONS,
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchMock,
    ...overrides,
  });
}

function cardOf(label: string): HTMLElement {
  return screen.getByText(label).closest("li") as HTMLElement;
}

beforeEach(() => {
  mockQuery();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("validateRewardLabel", () => {
  it("trims and accepts 1 to 40 characters", () => {
    expect(validateRewardLabel("  a  ")).toBeUndefined();
    expect(validateRewardLabel("가".repeat(40))).toBeUndefined();
  });

  it("rejects blank and over-long labels", () => {
    expect(validateRewardLabel("   ")).toBe("errorLabelRequired");
    expect(validateRewardLabel("가".repeat(41))).toBe("errorLabelTooLong");
  });
});

describe("CouponManagementPage", () => {
  it("shows loading, error with retry, and empty states", () => {
    mockQuery({ data: undefined, isLoading: true });
    const first = render(<CouponManagementPage />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    first.unmount();

    mockQuery({ data: undefined, isError: true, error: new Error("요청이 실패했습니다. (500)") });
    const second = render(<CouponManagementPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
    second.unmount();

    mockQuery({ data: [] });
    render(<CouponManagementPage />);
    expect(screen.getByText("등록된 쿠폰이 없습니다.")).toBeInTheDocument();
  });

  it("summarizes found and redeemed counts", () => {
    render(<CouponManagementPage />);
    expect(screen.getByRole("heading", { name: "쿠폰 관리" })).toBeInTheDocument();
    expect(screen.getByText("발견 2/3 · 교환 1")).toBeInTheDocument();
  });

  it("shows status badges and only the actions each state allows", () => {
    render(<CouponManagementPage />);

    const unclaimed = cardOf("하이볼 1잔");
    expect(within(unclaimed).getByText("미발견")).toBeInTheDocument();
    expect(within(unclaimed).queryByRole("button", { name: "교환 처리" })).toBeNull();
    expect(within(unclaimed).queryByRole("button", { name: "초기화" })).toBeNull();
    expect(within(unclaimed).getByRole("button", { name: "문구 수정" })).toBeInTheDocument();

    const claimed = cardOf("안주 1개");
    expect(within(claimed).getByText(/발견됨 \(테이블 T-03 · /)).toBeInTheDocument();
    expect(within(claimed).getByRole("button", { name: "교환 처리" })).toBeInTheDocument();
    expect(within(claimed).getByRole("button", { name: "초기화" })).toBeInTheDocument();

    const redeemed = cardOf("맥주 1병");
    expect(within(redeemed).getByText(/교환 완료 \(/)).toBeInTheDocument();
    expect(within(redeemed).queryByRole("button", { name: "교환 처리" })).toBeNull();
    expect(within(redeemed).getByRole("button", { name: "초기화" })).toBeInTheDocument();
  });

  it("redeems a claimed coupon", () => {
    render(<CouponManagementPage />);
    fireEvent.click(within(cardOf("안주 1개")).getByRole("button", { name: "교환 처리" }));
    expect(redeemMutate).toHaveBeenCalledWith("c2");
  });

  it("asks for confirmation with a warning before resetting", () => {
    render(<CouponManagementPage />);
    fireEvent.click(within(cardOf("안주 1개")).getByRole("button", { name: "초기화" }));

    expect(resetMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("초기화하면 손님이 이 쿠폰을 다시 찾을 수 있어요");

    fireEvent.click(within(dialog).getByRole("button", { name: "초기화" }));
    expect(resetMutate).toHaveBeenCalledWith("c2", expect.anything());
  });

  it("edits the reward label with trimmed input", () => {
    render(<CouponManagementPage />);
    fireEvent.click(within(cardOf("하이볼 1잔")).getByRole("button", { name: "문구 수정" }));

    const input = screen.getByLabelText("보상 문구");
    fireEvent.change(input, { target: { value: "  소주 1병  " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(updateMutate).toHaveBeenCalledWith(
      { id: "c1", rewardLabel: "소주 1병" },
      expect.anything(),
    );
  });

  it("blocks blank and over-long labels on the client", () => {
    render(<CouponManagementPage />);
    fireEvent.click(within(cardOf("하이볼 1잔")).getByRole("button", { name: "문구 수정" }));
    const input = screen.getByLabelText("보상 문구");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("보상 문구를 입력하세요.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "가".repeat(41) } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("보상 문구는 40자 이하로 입력하세요.")).toBeInTheDocument();

    expect(updateMutate).not.toHaveBeenCalled();
  });
});
