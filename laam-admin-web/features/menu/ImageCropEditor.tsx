"use client";

import "@/i18n/client";

import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { CROP_FRAME_SIZE, clampCropTransform, panCropTransform, zoomCropTransform, type CropTransform } from "./crop";

const KEYBOARD_PAN_STEP = 12;

type DragState = {
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
};

type ImageCropEditorProps = {
  imageUrl: string;
  transform: CropTransform;
  onTransformChange: (transform: CropTransform) => void;
};

const KEY_PAN_DELTA: Record<string, [number, number]> = {
  ArrowLeft: [KEYBOARD_PAN_STEP, 0],
  ArrowRight: [-KEYBOARD_PAN_STEP, 0],
  ArrowUp: [0, KEYBOARD_PAN_STEP],
  ArrowDown: [0, -KEYBOARD_PAN_STEP],
};

/**
 * Pointer-drag + keyboard-pan + zoom-range crop editor. The frame is a
 * fixed `CROP_FRAME_SIZE` square; the image is always sized/panned so it
 * fully covers that square (`clampCropTransform` in `./crop` is the single
 * source of truth for that boundary) — dragging or zooming can never leave
 * empty space inside the frame.
 */
export function ImageCropEditor({ imageUrl, transform, onTransformChange }: ImageCropEditorProps) {
  const { t } = useTranslation("menu");
  const dragStateRef = useRef<DragState | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    dragStateRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }
    onTransformChange(
      clampCropTransform({
        ...transform,
        offsetX: dragState.offsetX + (event.clientX - dragState.pointerX),
        offsetY: dragState.offsetY + (event.clientY - dragState.pointerY),
      }),
    );
  }

  function stopDragging() {
    dragStateRef.current = null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = KEY_PAN_DELTA[event.key];
    if (!delta) {
      return;
    }
    event.preventDefault();
    onTransformChange(panCropTransform(transform, delta[0], delta[1]));
  }

  function handleZoomChange(nextScale: number) {
    onTransformChange(zoomCropTransform(transform, nextScale));
  }

  const scaledWidth = transform.baseWidth * transform.scale;
  const scaledHeight = transform.baseHeight * transform.scale;
  const previewSize = 72;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="application"
        aria-label={t("cropFrameAria")}
        tabIndex={0}
        className="relative mx-auto overflow-hidden rounded-2xl bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        style={{ width: CROP_FRAME_SIZE, height: CROP_FRAME_SIZE, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerLeave={stopDragging}
        onKeyDown={handleKeyDown}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- object/blob URL preview, not an optimizable remote asset */}
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="absolute top-0 left-0 max-w-none select-none"
          style={{
            width: scaledWidth,
            height: scaledHeight,
            transform: `translate(${transform.offsetX}px, ${transform.offsetY}px)`,
          }}
        />
      </div>

      <label className="flex flex-col gap-1.5 text-sm text-foreground">
        <span>{t("zoomLabel")}</span>
        <input
          type="range"
          aria-label={t("zoomAria")}
          min={1}
          max={3}
          step={0.01}
          value={transform.scale}
          onChange={(event) => handleZoomChange(Number(event.target.value))}
        />
      </label>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("previewLabel")}</span>
        <div
          aria-hidden="true"
          className="overflow-hidden rounded-full border border-border"
          style={{
            width: previewSize,
            height: previewSize,
            backgroundImage: `url(${imageUrl})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${(scaledWidth * previewSize) / CROP_FRAME_SIZE}px ${(scaledHeight * previewSize) / CROP_FRAME_SIZE}px`,
            backgroundPosition: `${(transform.offsetX * previewSize) / CROP_FRAME_SIZE}px ${(transform.offsetY * previewSize) / CROP_FRAME_SIZE}px`,
          }}
        />
      </div>
    </div>
  );
}
