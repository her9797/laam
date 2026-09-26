import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentOrder } from "../model";
import type { BillDetail, BillPayment } from "./model";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const useBillQueryMock = vi.fn();
const refetchMock = vi.fn();

vi.mock("./queries", () => ({
  useBillQuery: (billId: string) => useBillQueryMock(billId),
}));

import { BillDetailPage } from "./BillDetailPage";

const MENU_ROW: PaymentOrder = {
  orderId: "order-1",
  menuItemName: "Pizza",
  categoryName: "Food",
  tableNumber: "7",
  requestNote: "",
  amount: 15000,
  vat: 1364,
  suppliedAmount: 13636,
  taxFreeAmount: 0,
  status: "DONE",
  paymentMethod: "CARD",
  posSyncStatus: "SUCCEEDED",
  posOrderId: "pos-1",
  createdAt: "2026-01-10T12:00:00Z",
};

const CARD_PAYMENT: BillPayment = {
  id: "pay-1",
  state: "APPROVED",
  sourceType: "CARD",
  paymentMethod: "신용카드",
  cardBrand: "신한카드",
  amount: 20000,
  taxAmount: 1818,
  supplyAmount: 18182,
  taxExemptAmount: 0,
  approvedNo: "A-12345",
  approvedAt: "2026-01-10T13:00:00Z",
};

const BILL: BillDetail = {
  id: "bill-1",
  posOrderId: "pos-1",
  tableNumber: "7",
  status: "PAID",
  openedAt: "2026-01-10T12:00:00Z",
  completedAt: "2026-01-10T13:00:00Z",
  totalAmount: 23000,
  discountAmount: 3000,
  paidAmount: 20000,
  paymentsSyncedAt: "2026-01-10T13:01:00Z",
  payments: [CARD_PAYMENT],
  menuItems: [
    MENU_ROW,
    { ...MENU_ROW, orderId: "order-2", menuItemName: "Beer", categoryName: "Drinks", amount: 8000 },
  ],
};

function defaultQueryResult() {
  return {
    data: BILL as BillDetail | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: refetchMock,
  };
}

function mockQuery(overrides: Partial<ReturnType<typeof defaultQueryResult>> = {}) {
  useBillQueryMock.mockReturnValue({ ...defaultQueryResult(), ...overrides });
}

function mockBill(overrides: Partial<BillDetail>) {
  mockQuery({ data: { ...BILL, ...overrides } });
}

function sectionByTitle(title: string): HTMLElement {
  return screen.getByText(title).closest('[data-slot="card"]') as HTMLElement;
}

describe("BillDetailPage", () => {
  beforeEach(() => {
    refetchMock.mockClear();
    useBillQueryMock.mockClear();
    mockQuery();
  });

  afterEach(() => {
    cleanup();
  });

  it("requests the bill by id", () => {
    render(<BillDetailPage billId="bill-1" />);
    expect(useBillQueryMock).toHaveBeenCalledWith("bill-1");
  });

  it("shows a loading state while the bill is loading", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<BillDetailPage billId="bill-1" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action when the query fails", () => {
    mockQuery({ data: undefined, isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<BillDetailPage billId="bill-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a not-found state when the bill doesn't exist", () => {
    mockQuery({ data: undefined });

    render(<BillDetailPage billId="missing" />);

    expect(screen.getByText("계산서를 찾을 수 없습니다.")).toBeInTheDocument();
  });

  it("links back to the bill view of the order list", () => {
    render(<BillDetailPage billId="bill-1" />);

    expect(screen.getByRole("link", { name: "목록으로" })).toHaveAttribute("href", "/orders?view=bill");
  });

  it("renders the header with the table number, status and times", () => {
    render(<BillDetailPage billId="bill-1" />);

    expect(screen.getByRole("heading", { name: "계산서 상세" })).toBeInTheDocument();
    expect(screen.getByText("테이블 7")).toBeInTheDocument();
    expect(screen.getByText("결제 완료")).toBeInTheDocument();
    expect(screen.getByText("주문 시작 시각")).toBeInTheDocument();
    expect(screen.getByText("결제 완료 시각")).toBeInTheDocument();
    expect(screen.queryByText("취소 시각")).not.toBeInTheDocument();
  });

  it.each([
    ["OPEN", "결제 대기"],
    ["CANCELLED", "취소"],
  ] as const)("renders a %s bill's status as %j", (status, label) => {
    mockBill({ status, completedAt: undefined, cancelledAt: status === "CANCELLED" ? "2026-01-10T14:00:00Z" : undefined });

    render(<BillDetailPage billId="bill-1" />);

    expect(screen.getByText(label)).toBeInTheDocument();
    if (status === "CANCELLED") {
      expect(screen.getByText("취소 시각")).toBeInTheDocument();
    }
  });

  it("renders total, discount and paid amounts", () => {
    render(<BillDetailPage billId="bill-1" />);

    const amounts = sectionByTitle("금액 요약");
    expect(within(amounts).getByText("₩23,000")).toBeInTheDocument();
    expect(within(amounts).getByText("할인 금액")).toBeInTheDocument();
    expect(within(amounts).getByText("₩3,000")).toBeInTheDocument();
    expect(within(amounts).getByText("₩20,000")).toBeInTheDocument();
  });

  it("hides the discount while it is still unknown (null)", () => {
    mockBill({ discountAmount: null });

    render(<BillDetailPage billId="bill-1" />);

    expect(screen.queryByText("할인 금액")).not.toBeInTheDocument();
  });

  it("warns that payments may be incomplete for a PAID bill whose payments are not synced yet", () => {
    mockBill({ paymentsSyncedAt: undefined });

    render(<BillDetailPage billId="bill-1" />);

    expect(screen.getByText(/결제 내역을 아직 불러오는 중입니다/)).toBeInTheDocument();
  });

  it.each([
    ["a synced PAID bill", { paymentsSyncedAt: "2026-01-10T13:01:00Z" }],
    ["an unsynced OPEN bill", { status: "OPEN", paymentsSyncedAt: undefined }],
  ] as const)("does not warn about incomplete payments for %s", (_name, overrides) => {
    mockBill(overrides);

    render(<BillDetailPage billId="bill-1" />);

    expect(screen.queryByText(/결제 내역을 아직 불러오는 중입니다/)).not.toBeInTheDocument();
  });

  it("renders each payment's method label, raw method, card brand, approval and amount", () => {
    render(<BillDetailPage billId="bill-1" />);

    const payments = sectionByTitle("결제 내역");
    const rows = within(payments).getAllByRole("row");
    // rows[0] is the header row.
    expect(within(rows[1]).getByText("카드")).toBeInTheDocument();
    expect(within(rows[1]).getByText("신용카드")).toBeInTheDocument();
    expect(within(rows[1]).getByText("신한카드")).toBeInTheDocument();
    expect(within(rows[1]).getByText("A-12345")).toBeInTheDocument();
    expect(within(rows[1]).getByText("₩20,000")).toBeInTheDocument();
    expect(within(rows[1]).getByText("승인")).toBeInTheDocument();
  });

  it("clearly marks a cancelled payment", () => {
    mockBill({
      payments: [CARD_PAYMENT, { ...CARD_PAYMENT, id: "pay-2", state: "CANCELLED", amount: 5000 }],
    });

    render(<BillDetailPage billId="bill-1" />);

    const payments = sectionByTitle("결제 내역");
    const cancelledRow = within(payments).getAllByRole("row")[2];
    expect(within(cancelledRow).getByText("결제 취소")).toBeInTheDocument();
    expect(cancelledRow).toHaveAttribute("data-payment-state", "CANCELLED");
  });

  it("shows an empty message when the bill has no payments", () => {
    mockBill({ status: "OPEN", payments: [] });

    render(<BillDetailPage billId="bill-1" />);

    expect(screen.getByText("결제 내역이 없습니다.")).toBeInTheDocument();
  });

  it("lists the menu rows, each linking to its order detail", () => {
    render(<BillDetailPage billId="bill-1" />);

    const menu = sectionByTitle("메뉴 내역");
    expect(within(menu).getByRole("link", { name: "Pizza" })).toHaveAttribute("href", "/orders/order-1");
    expect(within(menu).getByRole("link", { name: "Beer" })).toHaveAttribute("href", "/orders/order-2");
    expect(within(menu).getByText("Drinks")).toBeInTheDocument();
    expect(within(menu).getByText("₩8,000")).toBeInTheDocument();
    expect(within(menu).getAllByText("결제완료")).toHaveLength(2);
  });
});
