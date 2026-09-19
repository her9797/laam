import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FetchJsonError } from "@/lib/api/fetch-json";

import type { AdminTable, AdminTablesData, PosTable, PosTableSync } from "./model";

const toastAddMock = vi.fn();

vi.mock("@/components/ui/toast", () => ({
  toast: { add: (options: unknown) => toastAddMock(options) },
}));

type MutateOptions = {
  onSuccess?: (data: unknown) => void;
  onError?: (error: unknown) => void;
};

const syncMutate = vi.fn();
const linkMutate = vi.fn();
const createMutate = vi.fn();
const syncPending = { current: false };
const linkPending = { current: false };
const createPending = { current: false };

vi.mock("./queries", () => ({
  usePosTableSyncMutation: () => ({ mutate: syncMutate, isPending: syncPending.current }),
  useUpdateTablePosLinkMutation: () => ({ mutate: linkMutate, isPending: linkPending.current }),
  useCreateQrTableMutation: () => ({ mutate: createMutate, isPending: createPending.current }),
}));

import { PosTableLinkSection } from "./PosTableLinkSection";

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

function buildPosTable(overrides: Partial<PosTable> & Pick<PosTable, "posTableId">): PosTable {
  return {
    title: `POS ${overrides.posTableId}`,
    hallId: 1,
    hallName: "1층 홀",
    capacity: 4,
    syncedAt: "2026-09-19T00:00:00Z",
    qrTableId: null,
    ...overrides,
  };
}

function buildSync(overrides: Partial<PosTableSync> = {}): PosTableSync {
  return {
    id: "sync-1",
    status: "DONE",
    requestedAt: "2026-09-19T00:00:00Z",
    completedAt: "2026-09-19T00:00:10Z",
    linkedCount: 0,
    unlinkedCount: 0,
    posOnlyCount: 0,
    error: null,
    ...overrides,
  };
}

function buildData(overrides: Partial<AdminTablesData> = {}): AdminTablesData {
  return {
    tables: [
      buildTable({
        id: "T-01",
        area: "T",
        number: 1,
        posTableId: 11,
        posTableTitle: "1번 테이블",
        hallName: "1층 홀",
        linkedAt: "2026-09-19T00:00:00Z",
      }),
      buildTable({ id: "T-02", area: "T", number: 2 }),
    ],
    posOnlyTables: [buildPosTable({ posTableId: 22, title: "룸1" })],
    lastSyncedAt: "2026-09-19T01:02:03Z",
    pendingSync: null,
    ...overrides,
  };
}

/** Runs the `onSuccess` callback the component passed to a mutation's `mutate`. */
function resolveMutation(mutate: ReturnType<typeof vi.fn>, data: unknown, callIndex = 0) {
  const options = mutate.mock.calls[callIndex][1] as MutateOptions;
  options.onSuccess?.(data);
}

/** Runs the `onError` callback the component passed to a mutation's `mutate`. */
function rejectMutation(mutate: ReturnType<typeof vi.fn>, error: unknown, callIndex = 0) {
  const options = mutate.mock.calls[callIndex][1] as MutateOptions;
  options.onError?.(error);
}

describe("PosTableLinkSection", () => {
  beforeEach(() => {
    toastAddMock.mockReset();
    syncMutate.mockReset();
    linkMutate.mockReset();
    createMutate.mockReset();
    syncPending.current = false;
    linkPending.current = false;
    createPending.current = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the last sync time and the link summary counts", () => {
    render(<PosTableLinkSection data={buildData()} />);

    expect(screen.getByText("연결 필요 1 · POS에만 있음 1")).toBeInTheDocument();
    expect(screen.getByText(/마지막 동기화/)).toBeInTheDocument();
  });

  it("warns that unlinked tables cannot take customer orders", () => {
    render(<PosTableLinkSection data={buildData()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("이 테이블은 손님이 주문할 수 없어요");
  });

  it("hides the warning once every QR table is linked", () => {
    const data = buildData({
      tables: [
        buildTable({ id: "T-01", area: "T", number: 1, posTableId: 11, posTableTitle: "1번 테이블" }),
      ],
    });

    render(<PosTableLinkSection data={data} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // `linkedCount`/`unlinkedCount`/`posOnlyCount` are the state after the
  // sync, not what it changed — so the summary reads as a status line.
  it("starts a POS sync and reports the resulting link state when it finishes", async () => {
    render(<PosTableLinkSection data={buildData()} />);

    fireEvent.click(screen.getByRole("button", { name: "POS 테이블 가져오기" }));
    expect(syncMutate).toHaveBeenCalledTimes(1);

    resolveMutation(syncMutate, buildSync({ status: "DONE", linkedCount: 3, unlinkedCount: 1, posOnlyCount: 2 }));

    await waitFor(() => {
      expect(toastAddMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "연결됨 3 · 연결 필요 1 · POS에만 있음 2",
        }),
      );
    });
  });

  it("disables the sync button and shows progress copy while the sync runs", () => {
    syncPending.current = true;

    render(<PosTableLinkSection data={buildData()} />);

    const button = screen.getByRole("button", { name: "POS 테이블을 가져오는 중이에요…" });
    expect(button).toBeDisabled();
  });

  it("explains that the POS plugin is unreachable when the sync times out", async () => {
    render(<PosTableLinkSection data={buildData()} />);

    fireEvent.click(screen.getByRole("button", { name: "POS 테이블 가져오기" }));
    resolveMutation(syncMutate, buildSync({ status: "TIMED_OUT" }));

    await waitFor(() => {
      expect(toastAddMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title:
            "POS 플러그인이 응답하지 않아요. POS가 켜져 있고 플러그인이 설치됐는지 확인해 주세요.",
        }),
      );
    });
  });

  it("shows the linked POS table name and hall on a linked row", () => {
    render(<PosTableLinkSection data={buildData()} />);

    const row = screen.getByRole("listitem", { name: "T-01 테이블" });
    expect(within(row).getByText("연결됨")).toBeInTheDocument();
    expect(within(row).getByText("1번 테이블 · 1층 홀")).toBeInTheDocument();
  });

  it("unlinks a linked table when its unlink button is clicked", () => {
    render(<PosTableLinkSection data={buildData()} />);

    const row = screen.getByRole("listitem", { name: "T-01 테이블" });
    fireEvent.click(within(row).getByRole("button", { name: "연결 해제" }));

    expect(linkMutate).toHaveBeenCalledWith(
      { qrTableId: "T-01", posTableId: null },
      expect.anything(),
    );
  });

  it("links an unlinked table to the POS table the operator picked", () => {
    render(<PosTableLinkSection data={buildData()} />);

    const row = screen.getByRole("listitem", { name: "T-02 테이블" });
    expect(within(row).getByText("연결 필요")).toBeInTheDocument();
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "22" } });
    fireEvent.click(within(row).getByRole("button", { name: "저장" }));

    expect(linkMutate).toHaveBeenCalledWith(
      { qrTableId: "T-02", posTableId: 22 },
      expect.anything(),
    );
  });

  it("tells the operator when the POS table is already linked to another table", async () => {
    render(<PosTableLinkSection data={buildData()} />);

    const row = screen.getByRole("listitem", { name: "T-02 테이블" });
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "22" } });
    fireEvent.click(within(row).getByRole("button", { name: "저장" }));
    rejectMutation(linkMutate, new FetchJsonError(409, "already linked"));

    await waitFor(() => {
      expect(toastAddMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "그 POS 테이블은 이미 다른 테이블에 연결돼 있어요" }),
      );
    });
  });

  it("adds a POS-only table as a QR table, letting the server name it", () => {
    render(<PosTableLinkSection data={buildData()} />);

    const row = screen.getByRole("listitem", { name: "룸1" });
    fireEvent.click(within(row).getByRole("button", { name: "QR 테이블로 추가" }));

    expect(createMutate).toHaveBeenCalledWith({ posTableId: 22 }, expect.anything());
  });

  it("asks for a QR table name and retries when the server cannot derive one", async () => {
    render(<PosTableLinkSection data={buildData()} />);

    const row = screen.getByRole("listitem", { name: "룸1" });
    fireEvent.click(within(row).getByRole("button", { name: "QR 테이블로 추가" }));
    rejectMutation(createMutate, new FetchJsonError(400, "cannot derive id"));

    const nameInput = await within(row).findByLabelText("QR 테이블 이름");
    expect(within(row).getByText("T-11처럼 구역 문자와 두 자리 번호")).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: "T-11" } });
    fireEvent.click(within(row).getByRole("button", { name: "추가" }));

    await waitFor(() => {
      expect(createMutate).toHaveBeenLastCalledWith(
        { posTableId: 22, id: "T-11" },
        expect.anything(),
      );
    });
  });

  it("keeps the POS-only row closed when the first add succeeds", () => {
    render(<PosTableLinkSection data={buildData()} />);

    const row = screen.getByRole("listitem", { name: "룸1" });
    fireEvent.click(within(row).getByRole("button", { name: "QR 테이블로 추가" }));
    resolveMutation(createMutate, buildTable({ id: "T-11", area: "T", number: 11, posTableId: 22 }));

    expect(within(row).queryByLabelText("QR 테이블 이름")).not.toBeInTheDocument();
  });
});
