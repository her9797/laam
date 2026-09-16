/**
 * Geometry + rendering for the menu-image crop editor.
 *
 * Everything above `loadImageElement` is pure (no DOM/React), so the parts
 * that actually have to be correct — the "never show empty space around the
 * image, at any pan/zoom" boundary and the crop's source/destination
 * rectangles — can be unit-tested directly without a canvas or a mounted
 * component.
 *
 * Model: the image is rendered at `baseWidth`/`baseHeight` CSS pixels (the
 * size that makes the image's shorter side exactly fill a square viewport
 * of `CROP_FRAME_SIZE`), then scaled by `scale` (1-3) and panned by
 * `offsetX`/`offsetY`. `clampCropTransform` is the single place that
 * enforces both bounds:
 *   - `scale` stays within [MIN_SCALE, MAX_SCALE].
 *   - the scaled image can never leave a gap inside the frame: its left/top
 *     edge can't move past the frame's left/top edge (offset <= 0), and its
 *     right/bottom edge can't move before the frame's right/bottom edge
 *     (offset >= frameSize - scaledSize).
 *
 * How the crop reaches the server: `computeCropDrawRects` converts the
 * transform into the source rectangle (in the original image's own pixels)
 * that the frame is currently showing, and `cropImageFileToSquare` draws
 * exactly that region onto a `CROP_OUTPUT_SIZE` square canvas and returns it
 * as a new `File`. So the crop — pan *and* zoom — is baked into the uploaded
 * pixels, mirroring `laam-web/components/screens/admin-screen.tsx`'s
 * `cropImageFile`. Uploading the original file and describing the crop with
 * `focusX`/`focusY` alone cannot work: those two values are consumed by
 * `laam-web` as CSS `object-position` on the full image, which can express
 * centering but has no way to express zoom.
 *
 * `focusX`/`focusY` remain in the multipart payload (`laam-api`'s
 * `POST /api/v1/admin/menu-items/{id}/images` reads them with
 * `strconv.Atoi(r.FormValue(...))`, so an omitted field would silently mean
 * 0 — the image's top-left corner — rather than "unset"). Since the uploaded
 * bitmap is already the intended square crop, both are sent as
 * `UPLOAD_FOCUS_CENTER`, exactly what `laam-web`'s own admin screen sends
 * (`services/admin-service.ts`: `String(payload.focusX ?? 50)`).
 */

export const CROP_FRAME_SIZE = 280;
export const MIN_SCALE = 1;
export const MAX_SCALE = 3;

/**
 * Edge length, in pixels, of the square bitmap uploaded for a menu image.
 * Same 560 as `laam-web`'s `cropImageFile`, so both admin UIs produce
 * identically sized menu images.
 */
export const CROP_OUTPUT_SIZE = 560;

/**
 * The `focusX`/`focusY` value sent with every upload. A no-op (dead-centre)
 * `object-position`, because the crop is already baked into the pixels.
 */
export const UPLOAD_FOCUS_CENTER = 50;

export type CropTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  baseWidth: number;
  baseHeight: number;
};

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The single source of truth for keeping a `CropTransform` valid: scale
 * within range, and offset such that the scaled image fully covers the
 * `CROP_FRAME_SIZE` square (no empty space on any edge).
 */
export function clampCropTransform(transform: CropTransform): CropTransform {
  const scale = clampScale(transform.scale);
  const scaledWidth = transform.baseWidth * scale;
  const scaledHeight = transform.baseHeight * scale;

  // The image's top-left corner (offset) may never be positive (that would
  // leave a gap on the left/top), and may never be smaller than
  // `frame - scaled` (that would leave a gap on the right/bottom). When the
  // scaled image is smaller than the frame in some dimension (shouldn't
  // happen with a correctly built `baseWidth`/`baseHeight`, but defends
  // against it), `minX`/`minY` collapses to 0 so the offset is pinned there
  // instead of allowing an out-of-range gap.
  const minX = Math.min(0, CROP_FRAME_SIZE - scaledWidth);
  const minY = Math.min(0, CROP_FRAME_SIZE - scaledHeight);

  return {
    ...transform,
    scale,
    offsetX: Math.min(0, Math.max(minX, transform.offsetX)),
    offsetY: Math.min(0, Math.max(minY, transform.offsetY)),
  };
}

/**
 * Builds the initial transform for a freshly selected image: `scale` 1,
 * `baseWidth`/`baseHeight` sized so the image's shorter side exactly fills
 * the frame (cover-fit), and centered.
 */
export function createInitialCropTransform(naturalWidth: number, naturalHeight: number): CropTransform {
  const aspectRatio = naturalWidth / naturalHeight;
  const baseWidth = aspectRatio >= 1 ? CROP_FRAME_SIZE * aspectRatio : CROP_FRAME_SIZE;
  const baseHeight = aspectRatio >= 1 ? CROP_FRAME_SIZE : CROP_FRAME_SIZE / aspectRatio;

  return clampCropTransform({
    scale: MIN_SCALE,
    offsetX: (CROP_FRAME_SIZE - baseWidth) / 2,
    offsetY: (CROP_FRAME_SIZE - baseHeight) / 2,
    baseWidth,
    baseHeight,
  });
}

/**
 * Pans the image by a pointer/keyboard delta (in CSS pixels), then
 * re-clamps.
 */
export function panCropTransform(transform: CropTransform, deltaX: number, deltaY: number): CropTransform {
  return clampCropTransform({
    ...transform,
    offsetX: transform.offsetX + deltaX,
    offsetY: transform.offsetY + deltaY,
  });
}

/**
 * Zooms to `nextScale` around the frame's center, keeping whatever image
 * point is currently at the center fixed there, then re-clamps (which is
 * what makes zooming in from an edge feel stable instead of snapping).
 */
export function zoomCropTransform(transform: CropTransform, nextScale: number): CropTransform {
  const clampedScale = clampScale(nextScale);
  const frameCenter = CROP_FRAME_SIZE / 2;
  const currentWidth = transform.baseWidth * transform.scale;
  const currentHeight = transform.baseHeight * transform.scale;
  const nextWidth = transform.baseWidth * clampedScale;
  const nextHeight = transform.baseHeight * clampedScale;

  const relativeCenterX = (frameCenter - transform.offsetX) / currentWidth;
  const relativeCenterY = (frameCenter - transform.offsetY) / currentHeight;

  return clampCropTransform({
    ...transform,
    scale: clampedScale,
    offsetX: frameCenter - nextWidth * relativeCenterX,
    offsetY: frameCenter - nextHeight * relativeCenterY,
  });
}

export type ImageNaturalSize = {
  naturalWidth: number;
  naturalHeight: number;
};

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CropDrawRects = {
  /** Region of the ORIGINAL image to read from, in its own pixels. */
  source: CropRect;
  /** Region of the output canvas to draw into, in canvas pixels. */
  destination: CropRect;
};

/**
 * Pure translation of a `CropTransform` (frame-space CSS pixels) into the
 * `drawImage` source/destination rectangles needed to render the visible
 * crop at `outputSize` × `outputSize`.
 *
 * The frame shows `CROP_FRAME_SIZE` CSS pixels of an image laid out at
 * `baseWidth * scale` × `baseHeight * scale`, with its top-left corner at
 * `offsetX`/`offsetY` (both <= 0, per `clampCropTransform`). Converting a
 * frame-space length to original-image pixels is therefore a single ratio
 * per axis: `naturalWidth / (baseWidth * scale)`. That ratio is what carries
 * the zoom — at `scale` 3 the same 280px frame covers a third as many source
 * pixels as at `scale` 1, which is exactly the crop the operator selected.
 *
 * `Math.max(0, ...)` / `Math.min(natural - start, ...)` clamp away the
 * sub-pixel overshoot that floating-point rounding can produce at the pan
 * extremes; `drawImage` rejects a source rectangle that reaches outside the
 * image.
 */
export function computeCropDrawRects(
  transform: CropTransform,
  naturalSize: ImageNaturalSize,
  outputSize: number = CROP_OUTPUT_SIZE,
): CropDrawRects {
  const normalized = clampCropTransform(transform);
  const { naturalWidth, naturalHeight } = naturalSize;
  const scaledWidth = normalized.baseWidth * normalized.scale;
  const scaledHeight = normalized.baseHeight * normalized.scale;

  const sourceX = Math.max(0, (-normalized.offsetX / scaledWidth) * naturalWidth);
  const sourceY = Math.max(0, (-normalized.offsetY / scaledHeight) * naturalHeight);
  const sourceWidth = Math.min(
    naturalWidth - sourceX,
    (CROP_FRAME_SIZE / scaledWidth) * naturalWidth,
  );
  const sourceHeight = Math.min(
    naturalHeight - sourceY,
    (CROP_FRAME_SIZE / scaledHeight) * naturalHeight,
  );

  return {
    source: { x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight },
    destination: { x: 0, y: 0, width: outputSize, height: outputSize },
  };
}

/**
 * Decodes `url` (an object URL created from the selected `File`) into an
 * `HTMLImageElement`. Kept as its own export so component code can be tested
 * without a real image decode.
 */
export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    // Technical, never-displayed messages: every caller catches and shows its
    // own translated copy (see `features/menu`'s `menu:imageLoadFailed` /
    // `menu:cropFailed`).
    image.onerror = () => reject(new Error("menu image decode failed"));
    image.src = url;
  });
}

/**
 * Reads just the natural pixel dimensions of `url`, which
 * `createInitialCropTransform` needs. Tests mock this one function and keep
 * every pure geometry helper above real.
 */
export async function loadImageNaturalSize(url: string): Promise<ImageNaturalSize> {
  const image = await loadImageElement(url);
  return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
}

/**
 * The one side-effecting step: renders the crop `transform` selects out of
 * `file` onto a `CROP_OUTPUT_SIZE` square canvas and returns it as a new
 * `File` ready to upload. All coordinate math lives in
 * `computeCropDrawRects` above; this only performs the canvas I/O.
 *
 * The returned file keeps the original's name so the operator still
 * recognises it in the upload list, and reuses its MIME type when the
 * browser's encoder supports it (falling back to whatever `toBlob` actually
 * produced).
 */
export async function cropImageFileToSquare(
  file: File,
  transform: CropTransform,
  outputSize: number = CROP_OUTPUT_SIZE,
): Promise<File> {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(imageUrl);
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("menu image canvas context unavailable");
    }

    const { source, destination } = computeCropDrawRects(
      transform,
      { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
      outputSize,
    );

    context.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      destination.x,
      destination.y,
      destination.width,
      destination.height,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, file.type || "image/png", 0.92);
    });

    if (!blob) {
      throw new Error("menu image encode failed");
    }

    return new File([blob], file.name, { type: blob.type || file.type || "image/png" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
