import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminTable, AdminTablesData } from "./model";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const useAdminTablesQueryMock = vi.fn();
const refetchMock = vi.fn();
const idleMutation = { mutate: vi.fn(), isPending: false };

// The POS panel's own behavior lives in `PosTableLinkSection.test.tsx`; here
// the mutations stay idle so this file only covers what the `/tables` screen
// itself is responsible for — the query states and which sections it shows.
vi.mock("./queries", () => ({
  useAdminTablesQuery: () => useAdminTablesQueryMock(),
  usePosTableSyncMutation: () => idleMutation,
  useUpdateTablePosLinkMutation: () => idleMutation,
  useCreateQrTableMutation: () => idleMutation,
  useUpdateTableCodeMutation: () => idleMutation,
}));

import { TableManagementPage } from "./TableManagementPage";

function buildTable(
  overrides: Partial<AdminTable> & Pick<AdminTable, "id" | "area" | "number">,
): AdminTable {
  return {
    qrUrl: `https://example.com/qr/enter?table=${overrides.id}&sig=abc`,
    posTableId: null,
    posTableTitle: null,
    hallName: null,
    linkedAt: null,
    ...overrides,
  };
}

function buildData(overrides: Partial<AdminTablesData> = {}): AdminTablesData {
  return {
    tables: [
      buildTable({
        id: "B-01",
        area: "B",
        number: 1,
        posTableId: 11,
        posTableTitle: "바1",
        hallName: "1층 홀",
        linkedAt: "2026-09-19T00:00:00Z",
      }),
      buildTable({ id: "T-01", area: "T", number: 1 }),
    ],
    posOnlyTables: [],
    lastSyncedAt: "2026-09-19T00:00:00Z",
    pendingSync: null,
    ...overrides,
  };
}

describe("TableManagementPage", () => {
  beforeEach(() => {
    useAdminTablesQueryMock.mockReset();
    refetchMock.mockClear();
    useAdminTablesQueryMock.mockReturnValue({
      data: buildData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while the table list is loading", () => {
    useAdminTablesQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: refetchMock,
    });

    render(<TableManagementPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action when the query fails", () => {
    useAdminTablesQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      refetch: refetchMock,
    });

    render(<TableManagementPage />);

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders the POS sync controls and the per-table link rows", () => {
    render(<TableManagementPage />);

    expect(screen.getByRole("button", { name: "POS 테이블 가져오기" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "B-01 테이블" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "T-01 테이블" })).toBeInTheDocument();
  });

  // The QR cards, their per-table downloads and the bulk ZIP/print actions
  // moved to `/tables/qr`; this screen is the POS-link screen only.
  it("does not render the QR cards or their download actions", () => {
    render(<TableManagementPage />);

    expect(screen.queryByRole("button", { name: "PNG" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SVG" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "전체 ZIP 다운로드" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "인쇄용 PDF 시트" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("links to the QR screen so the operator can print the codes", () => {
    render(<TableManagementPage />);

    expect(screen.getByRole("link", { name: "QR 화면으로 이동" })).toHaveAttribute(
      "href",
      "/tables/qr",
    );
  });
});
