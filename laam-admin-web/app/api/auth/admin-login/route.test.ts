import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { isAdminSessionValid } from "@/lib/auth/session";

import { POST } from "./route";

function loginRequest(password: unknown) {
  return new NextRequest("http://localhost/api/auth/admin-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("POST /api/auth/admin-login", () => {
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
