import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminSessionValue, getAdminCookieName } from "@/lib/auth/session";

import { GET } from "./route";

function makeRequest(withSession = true) {
  const request = new NextRequest("http://localhost/api/bootstrap", {
    method: "GET",
  });
  if (withSession) {
    request.cookies.set(getAdminCookieName(), createAdminSessionValue());
  }
  return request;
}

const upstreamBody = {
  store: {
    name: "매장",
    subtitle: "",
    address: "",
    songRequestCopy: "",
    requestCopy: "",
    eventCopy: "",
  },
  categories: [{ id: "cat-1", label: "메뉴", isVisible: true }],
  items: [
    {
      id: "item-1",
      categoryId: "cat-1",
      name: "아메리카노",
      description: "",
      price: "4000",
      isVisible: true,
      images: [
        {
          id: "img-1",
          filename: "a.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 100,
          isPrimary: true,
          displayArea: "main",
          focusX: 50,
          focusY: 50,
          sortOrder: 0,
          contentUrl: "/api/v1/menu-images/img-1/content",
        },
      ],
    },
  ],
  requestGuides: [],
  notices: [],
};

describe("GET /api/bootstrap", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(upstreamBody), {
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
    const response = await GET(makeRequest(false));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls the public bootstrap endpoint directly, without an Authorization header", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${process.env.API_BASE_URL}/api/v1/bootstrap`);
    expect(init?.headers ?? {}).not.toHaveProperty("Authorization");
  });

  it("normalizes relative image URLs to the API asset origin", async () => {
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(body.items[0].images[0].contentUrl).toBe(
      `${process.env.API_BASE_URL}/api/v1/menu-images/img-1/content`,
    );
  });

  it("forwards the upstream error status when the public bootstrap call fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "boom" }), { status: 502 }),
    ) as unknown as typeof fetch;

    const response = await GET(makeRequest());

    expect(response.status).toBe(502);
  });
});
