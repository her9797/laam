import { describe, expect, it } from "vitest";

import {
  CROP_FRAME_SIZE,
  CROP_OUTPUT_SIZE,
  MAX_SCALE,
  MIN_SCALE,
  UPLOAD_FOCUS_CENTER,
  clampCropTransform,
  clampScale,
  computeCropDrawRects,
  createInitialCropTransform,
  panCropTransform,
  zoomCropTransform,
  type CropTransform,
} from "./crop";

describe("clampScale", () => {
  it("clamps below MIN_SCALE up to MIN_SCALE", () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
  });

  it("clamps above MAX_SCALE down to MAX_SCALE", () => {
    expect(clampScale(10)).toBe(MAX_SCALE);
  });

  it("keeps an in-range scale unchanged", () => {
    expect(clampScale(2)).toBe(2);
  });
});

describe("clampCropTransform", () => {
  // A wide (landscape) image: baseHeight matches the frame exactly, so
  // there is no vertical room to pan at scale 1, and baseWidth exceeds the
  // frame, leaving horizontal room.
  const wideBase: Pick<CropTransform, "baseWidth" | "baseHeight"> = {
    baseWidth: CROP_FRAME_SIZE * 2,
    baseHeight: CROP_FRAME_SIZE,
  };

  it("clamps an out-of-range scale as part of clamping the transform", () => {
    const result = clampCropTransform({ ...wideBase, scale: 8, offsetX: 0, offsetY: 0 });
    expect(result.scale).toBe(MAX_SCALE);
  });

  it("pins offsetY to 0 at scale 1 when the image height exactly fills the frame (no vertical slack)", () => {
    const draggedUp = clampCropTransform({ ...wideBase, scale: 1, offsetY: -999, offsetX: 0 });
    const draggedDown = clampCropTransform({ ...wideBase, scale: 1, offsetY: 999, offsetX: 0 });
    expect(draggedUp.offsetY).toBe(0);
    expect(draggedDown.offsetY).toBe(0);
  });

  it("never lets the offset drift so far that a gap opens on the left/top edge", () => {
    // Dragging the image far to the right/down (positive offset) would
    // uncover the frame's left/top edge if not clamped.
    const result = clampCropTransform({ ...wideBase, scale: 1, offsetX: 999, offsetY: 999 });
    expect(result.offsetX).toBeLessThanOrEqual(0);
    expect(result.offsetY).toBeLessThanOrEqual(0);
  });

  it("never lets the offset drift so far that a gap opens on the right/bottom edge", () => {
    // Dragging the image far to the left/up (very negative offset) would
    // uncover the frame's right/bottom edge if not clamped.
    const result = clampCropTransform({ ...wideBase, scale: 1, offsetX: -99999, offsetY: -99999 });
    const scaledWidth = wideBase.baseWidth * result.scale;
    const scaledHeight = wideBase.baseHeight * result.scale;
    expect(result.offsetX).toBeGreaterThanOrEqual(CROP_FRAME_SIZE - scaledWidth);
    expect(result.offsetY).toBeGreaterThanOrEqual(CROP_FRAME_SIZE - scaledHeight);
  });

  it("allows more horizontal pan range at scale 3 than at scale 1", () => {
    const atMinScale = clampCropTransform({ ...wideBase, scale: MIN_SCALE, offsetX: -99999, offsetY: 0 });
    const atMaxScale = clampCropTransform({ ...wideBase, scale: MAX_SCALE, offsetX: -99999, offsetY: 0 });
    // The minimum reachable (most negative) offsetX is more negative at a
    // higher scale, i.e. there's more room to pan.
    expect(atMaxScale.offsetX).toBeLessThan(atMinScale.offsetX);
  });

  it("leaves a valid transform unchanged", () => {
    const input: CropTransform = { ...wideBase, scale: 2, offsetX: -50, offsetY: 0 };
    expect(clampCropTransform(input)).toEqual(input);
  });
});

describe("createInitialCropTransform", () => {
  it("fits a landscape image so height matches the frame and width overflows, centered horizontally", () => {
    const transform = createInitialCropTransform(400, 200);
    expect(transform.baseHeight).toBeCloseTo(CROP_FRAME_SIZE);
    expect(transform.baseWidth).toBeGreaterThan(CROP_FRAME_SIZE);
    expect(transform.offsetY).toBe(0);
    expect(transform.offsetX).toBeCloseTo((CROP_FRAME_SIZE - transform.baseWidth) / 2);
  });

  it("fits a portrait image so width matches the frame and height overflows, centered vertically", () => {
    const transform = createInitialCropTransform(200, 400);
    expect(transform.baseWidth).toBeCloseTo(CROP_FRAME_SIZE);
    expect(transform.baseHeight).toBeGreaterThan(CROP_FRAME_SIZE);
    expect(transform.offsetX).toBe(0);
    expect(transform.offsetY).toBeCloseTo((CROP_FRAME_SIZE - transform.baseHeight) / 2);
  });

  it("fits a square image exactly to the frame with no pan slack", () => {
    const transform = createInitialCropTransform(300, 300);
    expect(transform.baseWidth).toBeCloseTo(CROP_FRAME_SIZE);
    expect(transform.baseHeight).toBeCloseTo(CROP_FRAME_SIZE);
    expect(transform.offsetX).toBe(0);
    expect(transform.offsetY).toBe(0);
  });

  it("starts at MIN_SCALE", () => {
    expect(createInitialCropTransform(400, 200).scale).toBe(MIN_SCALE);
  });
});

describe("panCropTransform", () => {
  it("applies a delta and clamps the result", () => {
    const start = createInitialCropTransform(400, 200);
    const panned = panCropTransform(start, -20, 0);
    expect(panned.offsetX).toBeCloseTo(start.offsetX - 20);
  });

  it("clamps a pan that would otherwise open a gap", () => {
    const start = createInitialCropTransform(400, 200);
    const panned = panCropTransform(start, -99999, 0);
    const scaledWidth = start.baseWidth * start.scale;
    expect(panned.offsetX).toBeGreaterThanOrEqual(CROP_FRAME_SIZE - scaledWidth);
  });

  it("never introduces vertical slack for an image with no vertical room", () => {
    const start = createInitialCropTransform(400, 200);
    const panned = panCropTransform(start, 0, 500);
    expect(panned.offsetY).toBe(0);
  });
});

describe("zoomCropTransform", () => {
  it("clamps the requested scale into [MIN_SCALE, MAX_SCALE]", () => {
    const start = createInitialCropTransform(400, 200);
    expect(zoomCropTransform(start, 10).scale).toBe(MAX_SCALE);
    expect(zoomCropTransform(start, -10).scale).toBe(MIN_SCALE);
  });

  it("keeps the frame fully covered immediately after zooming in", () => {
    const start = createInitialCropTransform(300, 300);
    const zoomed = zoomCropTransform(start, 3);
    const scaledWidth = zoomed.baseWidth * zoomed.scale;
    const scaledHeight = zoomed.baseHeight * zoomed.scale;
    expect(zoomed.offsetX).toBeLessThanOrEqual(0);
    expect(zoomed.offsetX).toBeGreaterThanOrEqual(CROP_FRAME_SIZE - scaledWidth);
    expect(zoomed.offsetY).toBeLessThanOrEqual(0);
    expect(zoomed.offsetY).toBeGreaterThanOrEqual(CROP_FRAME_SIZE - scaledHeight);
  });

  it("keeps the frame fully covered immediately after zooming back out to MIN_SCALE", () => {
    const start = createInitialCropTransform(300, 300);
    const zoomedIn = zoomCropTransform(start, 3);
    const zoomedOut = zoomCropTransform(zoomedIn, MIN_SCALE);
    expect(zoomedOut.offsetX).toBe(0);
    expect(zoomedOut.offsetY).toBe(0);
  });

  it("keeps the point at the frame center visually fixed while zooming", () => {
    // Pan a square image so its top-left quadrant sits at the frame
    // center, then zoom in: that same image point should still be at (or
    // very near) the frame center afterwards.
    const start = createInitialCropTransform(300, 300);
    const panned = panCropTransform(start, -70, -70);
    const zoomed = zoomCropTransform(panned, 2);

    const frameCenter = CROP_FRAME_SIZE / 2;
    const pannedImageXAtCenter = (frameCenter - panned.offsetX) / (panned.baseWidth * panned.scale);
    const zoomedImageXAtCenter = (frameCenter - zoomed.offsetX) / (zoomed.baseWidth * zoomed.scale);
    expect(zoomedImageXAtCenter).toBeCloseTo(pannedImageXAtCenter, 2);
  });
});

describe("computeCropDrawRects", () => {
  const SQUARE = { naturalWidth: 900, naturalHeight: 900 };
  const WIDE = { naturalWidth: 400, naturalHeight: 200 };

  it("draws the whole square source image at scale 1, into the full output canvas", () => {
    const transform = createInitialCropTransform(SQUARE.naturalWidth, SQUARE.naturalHeight);
    const { source, destination } = computeCropDrawRects(transform, SQUARE);

    expect(source.x).toBeCloseTo(0);
    expect(source.y).toBeCloseTo(0);
    expect(source.width).toBeCloseTo(SQUARE.naturalWidth);
    expect(source.height).toBeCloseTo(SQUARE.naturalHeight);
    expect(destination).toEqual({
      x: 0,
      y: 0,
      width: CROP_OUTPUT_SIZE,
      height: CROP_OUTPUT_SIZE,
    });
  });

  it("draws only the centre square of a wide image at scale 1 (cover-fit crop, not a squash)", () => {
    const transform = createInitialCropTransform(WIDE.naturalWidth, WIDE.naturalHeight);
    const { source } = computeCropDrawRects(transform, WIDE);

    // A 400x200 image cover-fitted into a square frame shows a 200x200
    // region, horizontally centred (x = (400 - 200) / 2).
    expect(source.width).toBeCloseTo(200);
    expect(source.height).toBeCloseTo(200);
    expect(source.x).toBeCloseTo(100);
    expect(source.y).toBeCloseTo(0);
  });

  // This is the regression the whole-branch review found: the old upload path
  // sent the ORIGINAL file plus a focus point, so zoom was silently discarded
  // and every zoom level produced byte-identical output. The source rectangle
  // must shrink as the operator zooms in.
  it("reads a strictly smaller source region as the scale increases (zoom actually crops)", () => {
    const atScale1 = createInitialCropTransform(SQUARE.naturalWidth, SQUARE.naturalHeight);
    const atScale2 = zoomCropTransform(atScale1, 2);
    const atScale3 = zoomCropTransform(atScale1, MAX_SCALE);

    const s1 = computeCropDrawRects(atScale1, SQUARE).source;
    const s2 = computeCropDrawRects(atScale2, SQUARE).source;
    const s3 = computeCropDrawRects(atScale3, SQUARE).source;

    expect(s2.width).toBeLessThan(s1.width);
    expect(s3.width).toBeLessThan(s2.width);
    // Scale N covers 1/N of the source per axis.
    expect(s2.width).toBeCloseTo(SQUARE.naturalWidth / 2);
    expect(s3.width).toBeCloseTo(SQUARE.naturalWidth / MAX_SCALE);
    expect(s3.height).toBeCloseTo(SQUARE.naturalHeight / MAX_SCALE);
  });

  it("keeps the output canvas size fixed regardless of scale (only the source region changes)", () => {
    const start = createInitialCropTransform(SQUARE.naturalWidth, SQUARE.naturalHeight);
    const zoomed = zoomCropTransform(start, MAX_SCALE);

    expect(computeCropDrawRects(start, SQUARE).destination).toEqual(
      computeCropDrawRects(zoomed, SQUARE).destination,
    );
  });

  it("moves the source region as the image is panned", () => {
    const centred = createInitialCropTransform(WIDE.naturalWidth, WIDE.naturalHeight);
    const pannedRight = panCropTransform(centred, -60, 0);

    const centredSource = computeCropDrawRects(centred, WIDE).source;
    const pannedSource = computeCropDrawRects(pannedRight, WIDE).source;

    expect(pannedSource.x).toBeGreaterThan(centredSource.x);
    // Panning changes only the origin, not how much is shown.
    expect(pannedSource.width).toBeCloseTo(centredSource.width);
  });

  it("never produces a source rectangle reaching outside the image, at either pan extreme", () => {
    const start = createInitialCropTransform(WIDE.naturalWidth, WIDE.naturalHeight);
    const zoomed = zoomCropTransform(start, MAX_SCALE);

    for (const transform of [
      panCropTransform(zoomed, 99999, 99999),
      panCropTransform(zoomed, -99999, -99999),
      panCropTransform(start, -99999, 0),
    ]) {
      const { source } = computeCropDrawRects(transform, WIDE);
      expect(source.x).toBeGreaterThanOrEqual(0);
      expect(source.y).toBeGreaterThanOrEqual(0);
      expect(source.width).toBeGreaterThan(0);
      expect(source.height).toBeGreaterThan(0);
      expect(source.x + source.width).toBeLessThanOrEqual(WIDE.naturalWidth + 1e-9);
      expect(source.y + source.height).toBeLessThanOrEqual(WIDE.naturalHeight + 1e-9);
    }
  });

  it("clamps an out-of-range transform before mapping it (same normalisation as the editor)", () => {
    const raw: CropTransform = {
      baseWidth: CROP_FRAME_SIZE,
      baseHeight: CROP_FRAME_SIZE,
      scale: 99,
      offsetX: 500,
      offsetY: 500,
    };
    const { source } = computeCropDrawRects(raw, SQUARE);

    expect(source.x).toBe(0);
    expect(source.y).toBe(0);
    expect(source.width).toBeCloseTo(SQUARE.naturalWidth / MAX_SCALE);
  });

  it("honours a caller-supplied output size", () => {
    const transform = createInitialCropTransform(SQUARE.naturalWidth, SQUARE.naturalHeight);
    expect(computeCropDrawRects(transform, SQUARE, 128).destination).toEqual({
      x: 0,
      y: 0,
      width: 128,
      height: 128,
    });
  });
});

describe("UPLOAD_FOCUS_CENTER", () => {
  // The crop is baked into the uploaded pixels, so `focusX`/`focusY` are a
  // deliberate no-op — dead centre, matching what `laam-web`'s own admin
  // screen sends (`services/admin-service.ts`: `payload.focusX ?? 50`).
  it("is the dead-centre object-position percentage", () => {
    expect(UPLOAD_FOCUS_CENTER).toBe(50);
  });
});
