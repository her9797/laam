import { readdirSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { createAdminSessionValue, getAdminCookieName } from "@/lib/auth/session";

import { config, proxy } from "./proxy";

function requestFor(pathname: string, cookieValue?: string): NextRequest {
  const request = new NextRequest(`http://localhost:3001${pathname}`);
  if (cookieValue !== undefined) {
    request.cookies.set(getAdminCookieName(), cookieValue);
  }
  return request;
}

const ADMIN_GROUP_DIR = join(process.cwd(), "app", "(admin)");

/** A directory is routable once a `page` file exists anywhere beneath it. */
function hasPage(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? hasPage(join(dir, entry.name))
      : /^page\.(tsx|ts|jsx|js)$/.test(entry.name),
  );
}

/**
 * The first URL segment of every route that exists under `app/(admin)/`, read
 * from disk so that adding a directory there without touching `proxy.ts` fails
 * this suite instead of silently shipping an unguarded admin page.
 *
 * Route groups (`(name)`) contribute no URL segment, so they are transparent
 * and we descend through them.
 */
function adminRouteSegments(dir: string = ADMIN_GROUP_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const child = join(dir, entry.name);
      if (entry.name.startsWith("(") && entry.name.endsWith(")")) {
        return adminRouteSegments(child);
      }
      return hasPage(child) ? [entry.name] : [];
    })
    .sort();
}

const MATCHED_SEGMENTS = config.matcher.map((pattern) =>
  pattern.replace("/:path*", "").replace(/^\//, ""),
);

const ADMIN_PATHS = MATCHED_SEGMENTS.map((segment) => `/${segment}`);

describe("proxy admin session gate", () => {
  it("redirects an anonymous visitor to /login on every admin route", () => {
    for (const pathname of ADMIN_PATHS) {
      const response = proxy(requestFor(pathname));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
    }
  });

  it("redirects a visitor whose session cookie is malformed", () => {
    const response = proxy(requestFor("/dashboard", "not-a-real-session"));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("redirects a visitor whose session signature does not verify", () => {
    const valid = createAdminSessionValue();
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("0") ? "1" : "0"}`;
    const response = proxy(requestFor("/dashboard", tampered));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("redirects a visitor whose session has expired", () => {
    const expired = createAdminSessionValue(new Date(Date.now() - 1000 * 60 * 60 * 24));
    const response = proxy(requestFor("/dashboard", expired));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("lets a valid session through without redirecting", () => {
    const response = proxy(requestFor("/dashboard", createAdminSessionValue()));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("guards every route directory that exists under app/(admin)/", () => {
    const segments = adminRouteSegments();
    expect(segments.length).toBeGreaterThan(0);

    const guarded = new Set(MATCHED_SEGMENTS);
    const unguarded = segments.filter((segment) => !guarded.has(segment));
    expect(unguarded).toEqual([]);
  });

  it("keeps no matcher entry for a directory that no longer exists", () => {
    const segments = new Set(adminRouteSegments());
    const stale = MATCHED_SEGMENTS.filter((segment) => !segments.has(segment));
    expect(stale).toEqual([]);
  });

  it("keeps every matcher entry in the statically analyzable `/segment/:path*` form", () => {
    for (const pattern of config.matcher) {
      expect(pattern).toMatch(/^\/[a-z0-9-]+\/:path\*$/);
    }
  });

  it("leaves /login and /api outside the matcher", () => {
    // `/login` and `/api/*` must stay outside the matcher: the login page has
    // to be reachable anonymously, and the BFF routes do their own auth.
    expect(config.matcher.some((pattern) => pattern.startsWith("/login"))).toBe(false);
    expect(config.matcher.some((pattern) => pattern.startsWith("/api"))).toBe(false);
  });
});
