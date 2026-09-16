import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchJsonError, fetchJson, isUnauthorizedError } from "./fetch-json";

describe("fetchJson", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("resolves with the parsed JSON body on success", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(fetchJson("/api/admin/categories")).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects with a status-carrying error for a failed response", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "internal" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(fetchJson("/api/admin/fail")).rejects.toMatchObject({
      status: 500,
    });
  });

  it("uses the upstream error message when the error body has one", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "잘못된 요청입니다." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(fetchJson("/api/admin/fail")).rejects.toMatchObject({
      status: 400,
      message: "잘못된 요청입니다.",
    });
  });

  it("still rejects with a status when the error body is not JSON", async () => {
    global.fetch = vi.fn(async () =>
      new Response("not json", { status: 502 }),
    ) as unknown as typeof fetch;

    await expect(fetchJson("/api/admin/fail")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("resolves with undefined for a 204 No Content response", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

    await expect(fetchJson("/api/admin/logout")).resolves.toBeUndefined();
  });

  it("passes init through to the underlying fetch call", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchJson("/api/admin/categories/1", { method: "DELETE" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/categories/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("isUnauthorizedError", () => {
  it("identifies a 401 FetchJsonError", () => {
    expect(isUnauthorizedError(new FetchJsonError(401, "인증 필요"))).toBe(true);
  });

  it("rejects other statuses and non-FetchJsonError values", () => {
    expect(isUnauthorizedError(new FetchJsonError(500, "오류"))).toBe(false);
    expect(isUnauthorizedError(new Error("plain"))).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });
});
