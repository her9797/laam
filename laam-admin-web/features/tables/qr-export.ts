/**
 * Client-side QR image generation and file export for the table QR
 * management screen. All generation happens in the browser from the
 * already-signed `qrUrl` string `laam-api` returns — nothing is rendered
 * server-side.
 */
import JSZip from "jszip";
import QRCode from "qrcode";

import type { AdminTable } from "./model";

const QR_PIXEL_SIZE = 512;

export function generateQrPngDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { width: QR_PIXEL_SIZE, margin: 1 });
}

export function generateQrSvgMarkup(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1 });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = /data:(.*);base64/.exec(header);
  const mime = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadTablePng(table: AdminTable): Promise<void> {
  const dataUrl = await generateQrPngDataUrl(table.qrUrl);
  downloadBlob(dataUrlToBlob(dataUrl), `${table.id}.png`);
}

export async function downloadTableSvg(table: AdminTable): Promise<void> {
  const svg = await generateQrSvgMarkup(table.qrUrl);
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${table.id}.svg`);
}

export async function buildTablesZipBlob(tables: AdminTable[]): Promise<Blob> {
  const zip = new JSZip();
  for (const table of tables) {
    const dataUrl = await generateQrPngDataUrl(table.qrUrl);
    const base64 = dataUrl.split(",")[1];
    zip.file(`${table.id}.png`, base64, { base64: true });
  }
  return zip.generateAsync({ type: "blob" });
}

export async function downloadTablesZip(tables: AdminTable[]): Promise<void> {
  const blob = await buildTablesZipBlob(tables);
  downloadBlob(blob, "table-qr-codes.zip");
}
