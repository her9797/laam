import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import {
  IP_MAX_FAILURES,
  resetLoginRateLimitForTests,
} from "@/lib/auth/login-rate-limit";
import { isAdminSessionValid } from "@/lib/auth/session";

import { POST } from "./route";

function loginRequest(password: unknown, forwardedFor?: string) {
  return new NextRequest("http://localhost/api/auth/admin-login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
    },
    body: JSON.stringify({ password }),
  });
}

function rawLoginRequest(body: string, forwardedFor: string) {
  return new NextRequest("http://localhost/api/auth/admin-login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": forwardedFor,
    },
    body,
  });
}

describe("POST /api/auth/admin-login", () => {
  beforeEach(() => {
    resetLoginRateLimitForTests();
  });

  describe("failed-attempt rate limit", () => {
    const attackerIp = "198.51.100.10";

    async function failRepeatedly(times: number, forwardedFor: string) {
      for (let i = 0; i < times; i += 1) {
        const response = await POST(loginRequest("wrong-password", forwardedFor));
        expect(response.status).toBe(401);
      }
    }

    it("rejects the next attempt with 429 even for the correct password once the limit is hit", async () => {
      await failRepeatedly(IP_MAX_FAILURES, attackerIp);

      const response = await POST(
        loginRequest(process.env.ADMIN_PASSWORD, attackerIp),
      );

      expect(response.status).toBe(429);
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(response.cookies.get("lam_admin_session")).toBeUndefined();
      expect(response.headers.get("set-cookie")).toBeNull();
      const payload = (await response.json()) as { error?: unknown };
      expect(typeof payload.error).toBe("string");
    });

    it("keys the limit on the rightmost X-Forwarded-For value, ignoring spoofed left values", async () => {
      for (let i = 0; i < IP_MAX_FAILURES; i += 1) {
        await POST(loginRequest("wrong-password", `10.0.0.${i}, ${attackerIp}`));
      }

      const response = await POST(
        loginRequest(process.env.ADMIN_PASSWORD, `10.9.9.9, ${attackerIp}`),
      );

      expect(response.status).toBe(429);
    });

    it("does not block a different client IP", async () => {
      await failRepeatedly(IP_MAX_FAILURES, attackerIp);

      const response = await POST(
        loginRequest(process.env.ADMIN_PASSWORD, "203.0.113.20"),
      );

      expect(response.status).toBe(200);
      expect(response.cookies.get("lam_admin_session")).toBeDefined();
    });

    it("clears the IP's failure count after a successful login", async () => {
      await failRepeatedly(IP_MAX_FAILURES - 1, attackerIp);
      const success = await POST(
        loginRequest(process.env.ADMIN_PASSWORD, attackerIp),
      );
      expect(success.status).toBe(200);

      await failRepeatedly(IP_MAX_FAILURES - 1, attackerIp);
      const response = await POST(
        loginRequest(process.env.ADMIN_PASSWORD, attackerIp),
      );

      expect(response.status).toBe(200);
    });

    it("does not let a parallel burst of wrong passwords exceed the per-IP limit", async () => {
      const burstSize = 20;

      const responses = await Promise.all(
        Array.from({ length: burstSize }, () =>
          POST(loginRequest("wrong-password", attackerIp)),
        ),
      );

      const statuses = responses.map((response) => response.status);
      const rejected = statuses.filter((status) => status === 401).length;
      const limited = statuses.filter((status) => status === 429).length;
      expect(rejected).toBe(IP_MAX_FAILURES);
      expect(limited).toBe(burstSize - IP_MAX_FAILURES);
    });

    it("counts empty passwords and malformed JSON as failures", async () => {
      await POST(loginRequest("", attackerIp));
      await POST(rawLoginRequest("{not json", attackerIp));
      await failRepeatedly(IP_MAX_FAILURES - 2, attackerIp);

      const response = await POST(
        loginRequest(process.env.ADMIN_PASSWORD, attackerIp),
      );

      expect(response.status).toBe(429);
    });
  });

  it("returns 401 for an incorrect password", async () => {
    const response = await POST(loginRequest("wrong-password"));

    expect(response.status).toBe(401);
    expect(response.cookies.get("lam_admin_session")).toBeUndefined();
  });

  it("returns 401 for a wrong password of the same length as the real one", async () => {
    const realPassword = process.env.ADMIN_PASSWORD ?? "";
    // Flip the last character so the guess is the same length as the real
    // password but still wrong — this is the case a naive length-check
    // shortcut (or a non-constant-time compare) would be most tempted to
    // special-case or leak timing on.
    const sameLengthWrongGuess = `${realPassword.slice(0, -1)}${
      realPassword.at(-1) === "x" ? "y" : "x"
    }`;

    const response = await POST(loginRequest(sameLengthWrongGuess));

    expect(response.status).toBe(401);
    expect(response.cookies.get("lam_admin_session")).toBeUndefined();
  });

  it("sets an HttpOnly, SameSite=Lax session cookie for the correct password", async () => {
    const response = await POST(loginRequest(process.env.ADMIN_PASSWORD));

    expect(response.status).toBe(200);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("lam_admin_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");

    const cookie = response.cookies.get("lam_admin_session");
    expect(cookie).toBeDefined();
    expect(isAdminSessionValid(cookie?.value)).toBe(true);
  });
});
