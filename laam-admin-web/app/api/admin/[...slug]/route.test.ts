import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminSessionValue, getAdminCookieName } from "@/lib/auth/session";

import { DELETE, GET, PATCH, POST } from "./route";

function withSessionCookie(request: NextRequest) {
  request.cookies.set(getAdminCookieName(), createAdminSessionValue());
  return request;
}

function makeRequest(
  method: string,
  path: string,
  init: {
    body?: BodyInit;
    headers?: Record<string, string>;
    withSession?: boolean;
  } = {},
) {
  const { withSession = true, body, headers } = init;
  const request = new NextRequest(`http://localhost/api/admin/${path}`, {
    method,
    ...(body !== undefined ? { body } : {}),
    ...(headers !== undefined ? { headers } : {}),
  });
  return withSession ? withSessionCookie(request) : request;
}

function context(slug: string[]) {
  return { params: Promise.resolve({ slug }) };
}

describe("/api/admin/[...slug] proxy", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects requests without a valid admin session", async () => {
    const request = makeRequest("GET", "categories", { withSession: false });
    const response = await GET(request, context(["categories"]));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects requests with a tampered admin session", async () => {
    const request = new NextRequest("http://localhost/api/admin/categories", {
      method: "GET",
    });
    request.cookies.set(getAdminCookieName(), "tampered-value");

    const response = await GET(request, context(["categories"]));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards GET requests to the upstream admin API with the bearer token", async () => {
    const request = makeRequest("GET", "categories");
    const response = await GET(request, context(["categories"]));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${process.env.API_BASE_URL}/api/v1/admin/categories`);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(
      `Bearer ${process.env.ADMIN_API_TOKEN}`,
    );
  });

  it("forwards POST requests with body and content-type preserved", async () => {
    const payload = JSON.stringify({ name: "새 카테고리" });
    const request = makeRequest("POST", "categories", {
      body: payload,
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, context(["categories"]));
    expect(response.status).toBe(200);

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${process.env.API_BASE_URL}/api/v1/admin/categories`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe(
      `Bearer ${process.env.ADMIN_API_TOKEN}`,
    );
    expect(Buffer.from(init.body).toString("utf-8")).toBe(payload);
  });

  it("forwards PATCH requests to the joined slug path", async () => {
    const request = makeRequest("PATCH", "customer-requests/42", {
      body: JSON.stringify({ status: "done" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, context(["customer-requests", "42"]));
    expect(response.status).toBe(200);

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      `${process.env.API_BASE_URL}/api/v1/admin/customer-requests/42`,
    );
  });

  it("forwards upstream 204 responses without attaching a response body", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const request = makeRequest("PATCH", "song-player/queue/queue-1/status", {
      body: JSON.stringify({ status: "completed" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(
      request,
      context(["song-player", "queue", "queue-1", "status"]),
    );

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it("rejects a slug segment that attempts path traversal", async () => {
    const request = makeRequest("GET", "..%2F..%2Fv2%2Fsecret", {
      withSession: true,
    });
    const response = await GET(request, context(["..", "..", "v2", "secret"]));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a single '..' slug segment", async () => {
    const request = makeRequest("GET", "categories/..", { withSession: true });
    const response = await GET(request, context(["categories", ".."]));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards DELETE requests without a body", async () => {
    const request = makeRequest("DELETE", "categories/1");
    const response = await DELETE(request, context(["categories", "1"]));
    expect(response.status).toBe(200);

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("forwards the query string to the upstream admin API", async () => {
    const request = makeRequest(
      "GET",
      "customer-requests?page=2&pageSize=20&status=pending",
    );
    const response = await GET(request, context(["customer-requests"]));

    expect(response.status).toBe(200);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      `${process.env.API_BASE_URL}/api/v1/admin/customer-requests?page=2&pageSize=20&status=pending`,
    );
  });
});
