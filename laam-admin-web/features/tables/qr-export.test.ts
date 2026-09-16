import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminTable } from "./model";

const toDataURLMock = vi.fn(async (_text: string, _options?: unknown) => "data:image/png;base64,AAAA");
const toStringMock = vi.fn(async (_text: string, _options?: unknown) => "<svg>mock</svg>");

vi.mock("qrcode", () => ({
  default: {
    toDataURL: (text: string, options: unknown) => toDataURLMock(text, options),
    toString: (text: string, options: unknown) => toStringMock(text, options),
  },
}));

import { buildTablesZipBlob, dataUrlToBlob, generateQrPngDataUrl, generateQrSvgMarkup } from "./qr-export";

const TABLES: AdminTable[] = [
  { id: "B-01", area: "B", number: 1, qrUrl: "https://example.com/qr/enter?table=B-01&sig=abc" },
  { id: "T-01", area: "T", number: 1, qrUrl: "https://example.com/qr/enter?table=T-01&sig=def" },
];

describe("qr-export", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("generates a PNG data URL for a table's qrUrl", async () => {
    const dataUrl = await generateQrPngDataUrl(TABLES[0].qrUrl);
    expect(dataUrl).toBe("data:image/png;base64,AAAA");
    expect(toDataURLMock).toHaveBeenCalledWith(
      TABLES[0].qrUrl,
      expect.objectContaining({ width: expect.any(Number) }),
    );
  });

  it("generates SVG markup for a table's qrUrl", async () => {
    const svg = await generateQrSvgMarkup(TABLES[0].qrUrl);
    expect(svg).toBe("<svg>mock</svg>");
    expect(toStringMock).toHaveBeenCalledWith(TABLES[0].qrUrl, expect.objectContaining({ type: "svg" }));
  });

  it("decodes a base64 PNG data URL into a Blob with the matching mime type", () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAAA");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("builds one zip entry named by table id for every table", async () => {
    const zip = await buildTablesZipBlob(TABLES);
    // JSZip generates a real zip Blob; unzip it back to confirm entry names.
    const JSZip = (await import("jszip")).default;
    const loaded = await JSZip.loadAsync(zip);
    expect(Object.keys(loaded.files).sort()).toEqual(["B-01.png", "T-01.png"]);
  });
});
