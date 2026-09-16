import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAdminCookieName, isAdminSessionValid } from "@/lib/auth/session";

/**
 * Server-side auth gate for the `(admin)` route group.
 *
 * `AGENTS.md` requires authentication to be enforced on the server rather
 * than by hiding UI ("인증, 인가, 객체 소유권은 서버에서 강제하며 UI 숨김을
 * 보안 통제로 사용하지 않는다"). Without this, an anonymous visitor to
 * `/dashboard` got the full admin shell rendered and was only bounced once a
 * client-side data fetch happened to 401.
 *
 * File name / export: Next.js 16 deprecated the `middleware` convention and
 * renamed it to `proxy` (see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
 * Runtime: Proxy defaults to the Node.js runtime in Next 16 and the
 * `runtime` config option is not available here (setting it throws), so
 * `lib/auth/session.ts`'s `node:crypto` HMAC verification is usable directly
 * — no separate Edge-safe verification path is needed.
 *
 * This gate is defence in depth, not the only check: every data-fetching BFF
 * route under `app/api/` verifies the session itself, and must keep doing so
 * (the `matcher` below deliberately does not cover `/api/*`).
 */

// Mirrors the directories in `app/(admin)/`. Kept as literal strings because
// `matcher` values must be statically analyzable at build time.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/orders/:path*",
    "/requests/:path*",
    "/song-requests/:path*",
    "/player/:path*",
    "/special-requests/:path*",
    "/menu/:path*",
    "/tables/:path*",
    "/notices/:path*",
    "/store-copy/:path*",
    "/system-logs/:path*",
  ],
};

export function proxy(request: NextRequest) {
  const cookieValue = request.cookies.get(getAdminCookieName())?.value;

  let isValid = false;
  try {
    isValid = isAdminSessionValid(cookieValue);
  } catch {
    // `isAdminSessionValid` throws when `SESSION_SECRET` is unset. A
    // misconfigured deployment must fail closed (treat every session as
    // invalid), never fail open into the admin shell.
    isValid = false;
  }

  if (isValid) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}
