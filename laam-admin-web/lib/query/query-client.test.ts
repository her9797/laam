import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchJsonError } from "@/lib/api/fetch-json";

import { createQueryClient } from "./query-client";

/**
 * This is the single centralized 401 → login-redirect boundary (per the
 * Task 4 brief's Step 4): no feature page/hook should special-case a 401
 * itself. These tests verify the boundary actually redirects for a 401 and
 * — just as importantly — does *not* redirect for any other error, so a
 * generic 500 never gets misrouted to the login page.
 */
describe("createQueryClient 401 boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /login when a query fails with a 401", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/dashboard", assign });

    const queryClient = createQueryClient();
    await queryClient.fetchQuery({
      queryKey: ["boundary-401"],
      queryFn: () => Promise.reject(new FetchJsonError(401, "인증 필요")),
      retry: false,
    }).catch(() => {});

    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("does not redirect when a query fails with a non-401 error", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/dashboard", assign });

    const queryClient = createQueryClient();
    await queryClient.fetchQuery({
      queryKey: ["boundary-500"],
      queryFn: () => Promise.reject(new FetchJsonError(500, "서버 오류")),
      retry: false,
    }).catch(() => {});

    expect(assign).not.toHaveBeenCalled();
  });

  it("does not redirect again when already on the login page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/login", assign });

    const queryClient = createQueryClient();
    await queryClient.fetchQuery({
      queryKey: ["boundary-401-already-on-login"],
      queryFn: () => Promise.reject(new FetchJsonError(401, "인증 필요")),
      retry: false,
    }).catch(() => {});

    expect(assign).not.toHaveBeenCalled();
  });

  it("does not retry a 401 but does retry other errors", () => {
    const queryClient = createQueryClient();
    const retryFn = queryClient.getDefaultOptions().queries?.retry as (
      failureCount: number,
      error: unknown,
    ) => boolean;

    expect(retryFn(0, new FetchJsonError(401, "인증 필요"))).toBe(false);
    expect(retryFn(0, new FetchJsonError(500, "서버 오류"))).toBe(true);
  });
});
