/**
 * Receipt photos are re-encoded in the browser before upload: a phone photo
 * is often 4000px and several MB (over the API's 5MiB limit), and drawing it
 * onto a canvas drops the EXIF block (GPS location, device) as a side effect.
 */

export const RECEIPT_IMAGE_MAX_SIDE = 1600;
export const RECEIPT_IMAGE_QUALITY = 0.85;

export function fitWithinMaxSide(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// `CanvasImageSource` narrowed to what is read here (an `ImageBitmap` in the browser).
type DecodedImage = { width: number; height: number; close?: () => void };

type ResizeDeps = {
  loadImage: (file: File) => Promise<DecodedImage>;
  createCanvas: () => HTMLCanvasElement;
};

const browserDeps: ResizeDeps = {
  // `imageOrientation: "from-image"` applies the EXIF rotation to the pixels
  // before the EXIF block itself is thrown away.
  loadImage: (file) => createImageBitmap(file, { imageOrientation: "from-image" }),
  createCanvas: () => document.createElement("canvas"),
};

export async function resizeReceiptImage(file: File, deps: ResizeDeps = browserDeps): Promise<File> {
  const image = await deps.loadImage(file);
  try {
    const size = fitWithinMaxSide(image.width, image.height, RECEIPT_IMAGE_MAX_SIDE);
    const canvas = deps.createCanvas();
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("receipt image canvas context unavailable");
    }
    context.drawImage(image as CanvasImageSource, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", RECEIPT_IMAGE_QUALITY),
    );
    if (!blob) {
      throw new Error("receipt image could not be encoded");
    }
    return new File([blob], "receipt.jpg", { type: "image/jpeg" });
  } finally {
    image.close?.();
  }
}
