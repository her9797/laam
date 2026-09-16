import { afterEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn((..._args: unknown[]) => ({ mocked: true }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string) => createClientMock(url, key),
}));

describe("getSupabaseClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns null when NEXT_PUBLIC_SUPABASE_URL is not set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const { getSupabaseClient } = await import("./client");

    expect(getSupabaseClient()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns null when NEXT_PUBLIC_SUPABASE_ANON_KEY is not set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { getSupabaseClient } = await import("./client");

    expect(getSupabaseClient()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("creates a client once and reuses it across calls when both are configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const { getSupabaseClient } = await import("./client");

    const first = getSupabaseClient();
    const second = getSupabaseClient();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith("https://project.supabase.co", "anon-key");
    expect(first).toBe(second);
  });
});
