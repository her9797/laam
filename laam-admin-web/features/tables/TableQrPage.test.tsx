import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

vi.mock("./queries", () => ({
  useAdminTablesQuery: () => useAdminTablesQueryMock(),
}));

const generateQrPngDataUrlMock = vi.fn(async (_text: string) => "data:image/png;base64,AAAA");
const downloadTablePngMock = vi.fn(async (_table: AdminTable) => undefined);
const downloadTableSvgMock = vi.fn(async (_table: AdminTable) => undefined);
const downloadTablesZipMock = vi.fn(async (_tables: AdminTable[]) => undefined);

vi.mock("./qr-export", () => ({
  generateQrPngDataUrl: (text: string) => generateQrPngDataUrlMock(text),
  downloadTablePng: (table: AdminTable) => downloadTablePngMock(table),
  downloadTableSvg: (table: AdminTable) => downloadTableSvgMock(table),
  downloadTablesZip: (tables: AdminTable[]) => downloadTablesZipMock(tables),
}));

import { TableQrPage } from "./TableQrPage";

/** Linked by default: an unlinked table has no usable QR, so it is opted into. */
function buildTable(
  id: string,
  area: AdminTable["area"],
  number: number,
  linked = true,
): AdminTable {
  return {
    id,
    area,
    number,
    qrUrl: `https://example.com/qr/enter?table=${id}&sig=abc`,
    posTableId: linked ? 100 + number : null,
    posTableTitle: linked ? `${id} POS` : null,
    hallName: null,
    linkedAt: linked ? "2026-09-19T00:00:00Z" : null,
  };
}

function buildTables(): AdminTable[] {
  return [
    ...Array.from({ length: 5 }, (_, i) => buildTable(`B-0${i + 1}`, "B", i + 1)),
    ...Array.from({ length: 10 }, (_, i) =>
      buildTable(`T-${String(i + 1).padStart(2, "0")}`, "T", i + 1),
    ),
  ];
}

function buildData(tables: AdminTable[] = buildTables()): AdminTablesData {
  return { tables, posOnlyTables: [], lastSyncedAt: null, pendingSync: null };
}

describe("TableQrPage", () => {
  beforeEach(() => {
    useAdminTablesQueryMock.mockReset();
    refetchMock.mockClear();
    generateQrPngDataUrlMock.mockClear();
    downloadTablePngMock.mockClear();
    downloadTableSvgMock.mockClear();
    downloadTablesZipMock.mockClear();
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

    render(<TableQrPage />);

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

    render(<TableQrPage />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders all 15 tables grouped into 5 bar tables and 10 regular tables", () => {
    render(<TableQrPage />);

    expect(screen.getByText("바 테이블")).toBeInTheDocument();
    expect(screen.getByText("일반 테이블")).toBeInTheDocument();

    for (let i = 1; i <= 5; i += 1) {
      expect(screen.getByText(`B-0${i} 테이블`)).toBeInTheDocument();
    }
    for (let i = 1; i <= 10; i += 1) {
      expect(screen.getByText(`T-${String(i).padStart(2, "0")} 테이블`)).toBeInTheDocument();
    }

    expect(screen.getAllByRole("button", { name: "PNG" })).toHaveLength(15);
    expect(screen.getAllByRole("button", { name: "SVG" })).toHaveLength(15);
  });

  it("renders each table's generated QR image", async () => {
    render(<TableQrPage />);

    await waitFor(() => {
      expect(generateQrPngDataUrlMock).toHaveBeenCalledTimes(15);
    });
    const images = await screen.findAllByRole("img");
    expect(images).toHaveLength(15);
    expect(images[0]).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  // An unlinked table cannot take orders, so its QR code would send the guest
  // to a table that can't be ordered from — it is left out of this screen
  // entirely rather than printed and stuck on a table.
  it("leaves unlinked tables out of the QR grid", () => {
    const tables = [
      buildTable("B-01", "B", 1),
      buildTable("T-01", "T", 1, false),
      buildTable("T-02", "T", 2),
    ];
    useAdminTablesQueryMock.mockReturnValue({
      data: buildData(tables),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });

    render(<TableQrPage />);

    expect(screen.getByText("B-01 테이블")).toBeInTheDocument();
    expect(screen.getByText("T-02 테이블")).toBeInTheDocument();
    expect(screen.queryByText("T-01 테이블")).not.toBeInTheDocument();
  });

  it("points the operator at the table screen when some tables are unlinked", () => {
    const tables = [
      buildTable("B-01", "B", 1),
      buildTable("T-01", "T", 1, false),
      buildTable("T-02", "T", 2, false),
    ];
    useAdminTablesQueryMock.mockReturnValue({
      data: buildData(tables),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });

    render(<TableQrPage />);

    expect(
      screen.getByText("연결되지 않은 테이블 2개는 QR이 나오지 않아요. 테이블 화면에서 연결해 주세요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "테이블 화면으로 이동" })).toHaveAttribute(
      "href",
      "/tables",
    );
  });

  it("does not nag about unlinked tables when every table is linked", () => {
    render(<TableQrPage />);

    expect(screen.queryByRole("link", { name: "테이블 화면으로 이동" })).not.toBeInTheDocument();
  });

  it("shows an empty state with a link to the table screen when nothing is linked", () => {
    useAdminTablesQueryMock.mockReturnValue({
      data: buildData([buildTable("T-01", "T", 1, false)]),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });

    render(<TableQrPage />);

    expect(screen.getByText("QR을 만들 수 있는 테이블이 없어요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "테이블 화면으로 이동" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PNG" })).not.toBeInTheDocument();
  });

  it("downloads a single table's PNG when its button is clicked", async () => {
    render(<TableQrPage />);

    const card = screen.getByText("B-01 테이블").closest("div") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "PNG" }));

    await waitFor(() => {
      expect(downloadTablePngMock).toHaveBeenCalledWith(expect.objectContaining({ id: "B-01" }));
    });
  });

  it("puts only the linked tables in the bulk zip", async () => {
    const tables = [buildTable("B-01", "B", 1), buildTable("T-01", "T", 1, false)];
    useAdminTablesQueryMock.mockReturnValue({
      data: buildData(tables),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });

    render(<TableQrPage />);

    fireEvent.click(screen.getByRole("button", { name: "전체 ZIP 다운로드" }));

    await waitFor(() => {
      expect(downloadTablesZipMock).toHaveBeenCalledWith([expect.objectContaining({ id: "B-01" })]);
    });
  });

  it("opens the browser print dialog when the print-sheet button is clicked", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    render(<TableQrPage />);
    fireEvent.click(screen.getByRole("button", { name: "인쇄용 PDF 시트" }));

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it("copies the table's link when its QR code image is clicked", async () => {
    const writeTextMock = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<TableQrPage />);

    const images = await screen.findAllByRole("img");
    fireEvent.click(images[0]);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("https://example.com/qr/enter?table=B-01&sig=abc");
    });
    expect(await screen.findByText("링크를 복사했습니다.")).toBeInTheDocument();
  });

  it("shows an error message when copying the table's link fails", async () => {
    const writeTextMock = vi.fn(async () => {
      throw new Error("denied");
    });
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<TableQrPage />);

    const images = await screen.findAllByRole("img");
    fireEvent.click(images[0]);

    expect(await screen.findByText("링크 복사에 실패했습니다.")).toBeInTheDocument();
  });
});
