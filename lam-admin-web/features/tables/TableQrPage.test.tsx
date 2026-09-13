import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminTable } from "./model";

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

function buildTables(): AdminTable[] {
  const bTables: AdminTable[] = Array.from({ length: 5 }, (_, i) => ({
    id: `B-0${i + 1}`,
    area: "B",
    number: i + 1,
    qrUrl: `https://example.com/qr/enter?table=B-0${i + 1}&sig=abc`,
  }));
  const tTables: AdminTable[] = Array.from({ length: 10 }, (_, i) => ({
    id: `T-${String(i + 1).padStart(2, "0")}`,
    area: "T",
    number: i + 1,
    qrUrl: `https://example.com/qr/enter?table=T-${String(i + 1).padStart(2, "0")}&sig=def`,
  }));
  return [...bTables, ...tTables];
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
      data: buildTables(),
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

  it("downloads a single table's PNG when its button is clicked", async () => {
    render(<TableQrPage />);

    const card = screen.getByText("B-01 테이블").closest("div") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "PNG" }));

    await waitFor(() => {
      expect(downloadTablePngMock).toHaveBeenCalledWith(expect.objectContaining({ id: "B-01" }));
    });
  });

  it("downloads all tables as a zip when the bulk button is clicked", async () => {
    render(<TableQrPage />);

    fireEvent.click(screen.getByRole("button", { name: "전체 ZIP 다운로드" }));

    await waitFor(() => {
      expect(downloadTablesZipMock).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "B-01" })]));
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
