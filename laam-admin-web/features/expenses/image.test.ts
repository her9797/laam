import { describe, expect, it, vi } from "vitest";

import {
  RECEIPT_IMAGE_MAX_SIDE,
  RECEIPT_IMAGE_QUALITY,
  fitWithinMaxSide,
  resizeReceiptImage,
} from "./image";

describe("fitWithinMaxSide", () => {
  it("scales the long side down to the limit keeping the aspect ratio", () => {
    expect(fitWithinMaxSide(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithinMaxSide(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("never scales a small image up", () => {
    expect(fitWithinMaxSide(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe("resizeReceiptImage", () => {
  it("redraws the photo onto a canvas and re-encodes it as JPEG", async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(["jpeg"], { type: "image/jpeg" })));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
    const source = { width: 3200, height: 2400, close: vi.fn() };

    const result = await resizeReceiptImage(new File(["x"], "photo.png", { type: "image/png" }), {
      loadImage: async () => source,
      createCanvas: () => canvas as unknown as HTMLCanvasElement,
    });

    expect(RECEIPT_IMAGE_MAX_SIDE).toBe(1600);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1600, 1200);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", RECEIPT_IMAGE_QUALITY);
    expect(RECEIPT_IMAGE_QUALITY).toBe(0.85);
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("receipt.jpg");
    expect(source.close).toHaveBeenCalled();
  });

  it("fails when the browser cannot encode the image", async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback) => callback(null),
    };
    await expect(
      resizeReceiptImage(new File(["x"], "a.jpg", { type: "image/jpeg" }), {
        loadImage: async () => ({ width: 10, height: 10 }),
        createCanvas: () => canvas as unknown as HTMLCanvasElement,
      }),
    ).rejects.toThrow();
  });
});
