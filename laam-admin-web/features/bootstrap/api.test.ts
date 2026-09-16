import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBootstrap, normalizeAppDataImages } from "./api";
import type { AppData } from "./model";

function makeAppData(contentUrl: string): AppData {
  return {
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
            contentUrl,
          },
        ],
      },
    ],
    requestGuides: [],
    notices: [],
  };
}

describe("normalizeAppDataImages", () => {
  it("prefixes a relative contentUrl with the asset base URL", () => {
    const data = makeAppData("/api/v1/menu-images/img-1/content");
    const normalized = normalizeAppDataImages(data, "http://127.0.0.1:9999");

    expect(normalized.items[0].images?.[0].contentUrl).toBe(
      "http://127.0.0.1:9999/api/v1/menu-images/img-1/content",
    );
  });

  it("leaves an already-absolute contentUrl untouched", () => {
    const data = makeAppData("https://cdn.example.com/img-1.jpg");
    const normalized = normalizeAppDataImages(data, "http://127.0.0.1:9999");

    expect(normalized.items[0].images?.[0].contentUrl).toBe(
      "https://cdn.example.com/img-1.jpg",
    );
  });

  it("does not mutate the input", () => {
    const data = makeAppData("/api/v1/menu-images/img-1/content");
    normalizeAppDataImages(data, "http://127.0.0.1:9999");

    expect(data.items[0].images?.[0].contentUrl).toBe(
      "/api/v1/menu-images/img-1/content",
    );
  });
});

describe("fetchBootstrap", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches AppData from the bootstrap BFF route, not laam-api directly", async () => {
    const fixture = makeAppData("http://127.0.0.1:9999/api/v1/menu-images/img-1/content");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const data = await fetchBootstrap();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bootstrap",
      expect.objectContaining({ method: "GET" }),
    );
    expect(data.categories[0]).toMatchObject({ id: "cat-1" });
  });

  it("rejects with the upstream status when the request fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "server error" }), { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(fetchBootstrap()).rejects.toMatchObject({ status: 500 });
  });
});
