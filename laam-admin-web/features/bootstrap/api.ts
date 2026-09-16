import { fetchJson } from "@/lib/api/fetch-json";

import type { AppData, MenuItem } from "./model";

const BOOTSTRAP_BFF_PATH = "/api/bootstrap";

/**
 * Client-side fetch for the browser: always goes through this app's own
 * `/api/bootstrap` BFF route, never `laam-api` directly. The BFF route
 * (`app/api/bootstrap/route.ts`) is the one place that talks to the
 * upstream `laam-api` origin and normalizes image URLs before the browser
 * ever sees them.
 */
export function fetchBootstrap(): Promise<AppData> {
  return fetchJson<AppData>(BOOTSTRAP_BFF_PATH, { method: "GET" });
}

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function normalizeContentUrl(contentUrl: string, assetBaseUrl: string): string {
  if (isAbsoluteUrl(contentUrl) || !assetBaseUrl) {
    return contentUrl;
  }
  return `${assetBaseUrl}${contentUrl}`;
}

function normalizeMenuItemImages(item: MenuItem, assetBaseUrl: string): MenuItem {
  if (!item.images) {
    return item;
  }
  return {
    ...item,
    images: item.images.map((image) => ({
      ...image,
      contentUrl: normalizeContentUrl(image.contentUrl, assetBaseUrl),
    })),
  };
}

/**
 * Rewrites every relative `MenuImage.contentUrl` in `appData` into an
 * absolute API asset URL under `assetBaseUrl`. This is the single place
 * relative image URLs get resolved — called once, server-side, from the
 * `/api/bootstrap` BFF route handler (which alone has `API_BASE_URL`) so
 * the browser always receives ready-to-use absolute URLs and never needs
 * to know the upstream `laam-api` origin itself.
 *
 * An already-absolute `contentUrl` (e.g. from a CDN) is left untouched.
 * Does not mutate its input.
 */
export function normalizeAppDataImages(appData: AppData, assetBaseUrl: string): AppData {
  return {
    ...appData,
    items: appData.items.map((item) => normalizeMenuItemImages(item, assetBaseUrl)),
  };
}
