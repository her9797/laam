import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppData, NoticeItem } from "@/features/bootstrap/model";
import { bootstrapKeys, useBootstrapQuery } from "@/features/bootstrap/queries";

vi.mock("@/lib/api/fetch-json", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/fetch-json")>(
    "@/lib/api/fetch-json",
  );
  return { ...actual, fetchJson: vi.fn() };
});

import { fetchJson } from "@/lib/api/fetch-json";

import {
  useCreateNoticeMutation,
  useDeleteNoticeMutation,
  useUpdateNoticeMutation,
  useUpdateNoticeVisibilityMutation,
} from "./api";

const HIGHBALL: NoticeItem = { id: "notice-1", text: "매주 수요일 하이볼 1,000원 할인", isVisible: true };
const LIVE: NoticeItem = { id: "notice-2", text: "금요일 라이브 공연", isVisible: true };

function appDataWith(notices: NoticeItem[]): AppData {
  return {
    store: {
      name: "가게",
      subtitle: "",
      address: "",
      songRequestCopy: "",
      requestCopy: "",
      eventCopy: "",
    },
    categories: [],
    items: [],
    requestGuides: [],
    notices,
  };
}

const INITIAL = appDataWith([HIGHBALL, LIVE]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Routes `fetchJson` by `"METHOD path"` so each test decides when every
 * response "arrives" — the whole point of these tests is controlling that
 * order.
 */
function routeRequests(routes: Record<string, () => Promise<AppData>>) {
  vi.mocked(fetchJson).mockImplementation(((input: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${input}`;
    const respond = routes[key];
    if (!respond) {
      throw new Error(`unexpected request: ${key}`);
    }
    return respond();
  }) as typeof fetchJson);
}

function requestCount(key: string): number {
  return vi
    .mocked(fetchJson)
    .mock.calls.filter(([input, init]) => `${init?.method ?? "GET"} ${input}` === key).length;
}

function renderNoticeHooks({ withBootstrapObserver }: { withBootstrapObserver: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(
    () => ({
      // Stands in for `NoticeManagementPage`, which keeps `bootstrapKeys.all`
      // active while these mutations run.
      bootstrap: withBootstrapObserver ? useBootstrapQuery() : undefined,
      create: useCreateNoticeMutation(),
      update: useUpdateNoticeMutation(),
      visibility: useUpdateNoticeVisibilityMutation(),
      remove: useDeleteNoticeMutation(),
    }),
    { wrapper: Wrapper },
  );
  return { queryClient, result };
}

async function flushPendingWork() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.mocked(fetchJson).mockReset();
});

describe("notice mutations writing the bootstrap cache", () => {
  it("keeps a later-started mutation's snapshot when an earlier-started mutation's response arrives last", async () => {
    // The visibility toggle starts first, but the server reads its snapshot
    // before the delete commits, and that older response arrives last.
    const visibilityResponse = deferred<AppData>();
    const deleteResponse = deferred<AppData>();
    const afterVisibilityOnly = appDataWith([{ ...HIGHBALL, isVisible: false }, LIVE]);
    const afterBoth = appDataWith([{ ...HIGHBALL, isVisible: false }]);
    routeRequests({
      "PATCH /api/admin/notices/notice-1/visibility": () => visibilityResponse.promise,
      "DELETE /api/admin/notices/notice-2": () => deleteResponse.promise,
    });
    const { queryClient, result } = renderNoticeHooks({ withBootstrapObserver: false });
    queryClient.setQueryData(bootstrapKeys.all, INITIAL);

    act(() => {
      result.current.visibility.mutate({ id: "notice-1", isVisible: false });
      result.current.remove.mutate("notice-2");
    });
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));

    await act(async () => deleteResponse.resolve(afterBoth));
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    await act(async () => visibilityResponse.resolve(afterVisibilityOnly));
    await waitFor(() => expect(result.current.visibility.isSuccess).toBe(true));

    expect(queryClient.getQueryData(bootstrapKeys.all)).toEqual(afterBoth);
  });

  it("refetches bootstrap once overlapping mutations have all settled, converging on the server's latest state", async () => {
    // Responses arrive in start order, but the server committed the text
    // edit (started second) before the visibility toggle, so the edit's
    // response is the older snapshot — only the server can tell.
    const visibilityResponse = deferred<AppData>();
    const updateResponse = deferred<AppData>();
    const editedLive = { ...LIVE, text: "금요일 라이브 공연 (8시 시작)" };
    const serverLatest = appDataWith([{ ...HIGHBALL, isVisible: false }, editedLive]);
    const olderUpdateSnapshot = appDataWith([HIGHBALL, editedLive]);
    let bootstrapRequests = 0;
    routeRequests({
      "GET /api/bootstrap": async () => (bootstrapRequests++ === 0 ? INITIAL : serverLatest),
      "PATCH /api/admin/notices/notice-1/visibility": () => visibilityResponse.promise,
      "PATCH /api/admin/notices/notice-2": () => updateResponse.promise,
    });
    const { queryClient, result } = renderNoticeHooks({ withBootstrapObserver: true });
    await waitFor(() => expect(result.current.bootstrap?.isSuccess).toBe(true));

    act(() => {
      result.current.visibility.mutate({ id: "notice-1", isVisible: false });
      result.current.update.mutate({ id: "notice-2", text: editedLive.text });
    });
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(3));

    await act(async () => visibilityResponse.resolve(serverLatest));
    await waitFor(() => expect(result.current.visibility.isSuccess).toBe(true));
    await act(async () => updateResponse.resolve(olderUpdateSnapshot));
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));

    await waitFor(() => expect(queryClient.getQueryData(bootstrapKeys.all)).toEqual(serverLatest));
    await flushPendingWork();
    expect(requestCount("GET /api/bootstrap")).toBe(2);
  });

  it("does not let an in-flight bootstrap refetch overwrite a mutation's newer snapshot", async () => {
    // e.g. a window-focus refetch that read the store before the delete
    // committed, but whose response lands after the delete's.
    const staleRefetch = deferred<AppData>();
    const deleteResponse = deferred<AppData>();
    const afterDelete = appDataWith([HIGHBALL]);
    let bootstrapRequests = 0;
    routeRequests({
      "GET /api/bootstrap": () =>
        bootstrapRequests++ === 0 ? Promise.resolve(INITIAL) : staleRefetch.promise,
      "DELETE /api/admin/notices/notice-2": () => deleteResponse.promise,
    });
    const { queryClient, result } = renderNoticeHooks({ withBootstrapObserver: true });
    await waitFor(() => expect(result.current.bootstrap?.isSuccess).toBe(true));

    act(() => {
      void result.current.bootstrap?.refetch();
      result.current.remove.mutate("notice-2");
    });
    await waitFor(() => expect(requestCount("DELETE /api/admin/notices/notice-2")).toBe(1));
    expect(requestCount("GET /api/bootstrap")).toBe(2);

    await act(async () => deleteResponse.resolve(afterDelete));
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    await act(async () => staleRefetch.resolve(INITIAL));
    await flushPendingWork();

    expect(queryClient.getQueryData(bootstrapKeys.all)).toEqual(afterDelete);
  });

  it("writes a lone mutation's snapshot straight into the cache without refetching bootstrap", async () => {
    const createResponse = deferred<AppData>();
    const created: NoticeItem = { id: "notice-3", text: "토요일 휴무", isVisible: true };
    const afterCreate = appDataWith([HIGHBALL, LIVE, created]);
    routeRequests({
      "GET /api/bootstrap": async () => INITIAL,
      "POST /api/admin/notices": () => createResponse.promise,
    });
    const { queryClient, result } = renderNoticeHooks({ withBootstrapObserver: true });
    await waitFor(() => expect(result.current.bootstrap?.isSuccess).toBe(true));

    act(() => {
      result.current.create.mutate({ text: created.text, isVisible: true });
    });
    await waitFor(() => expect(requestCount("POST /api/admin/notices")).toBe(1));
    await act(async () => createResponse.resolve(afterCreate));
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    expect(queryClient.getQueryData(bootstrapKeys.all)).toEqual(afterCreate);
    await flushPendingWork();
    expect(requestCount("GET /api/bootstrap")).toBe(1);
  });
});
