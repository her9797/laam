import { fetchJson } from "@/lib/api/fetch-json";
import type { AppData } from "@/features/bootstrap/model";

import type {
  CatalogSyncResponse,
  CreateCategoryInput,
  CreateMenuItemInput,
  MenuItemRecipe,
  UpdateMenuItemRecipeInput,
  UploadMenuItemImageInput,
} from "./model";

const CATEGORIES_PATH = "/api/admin/categories";
const MENU_ITEMS_PATH = "/api/admin/menu-items";
const CATALOG_SYNC_PATH = "/api/admin/catalog-sync";

/**
 * Every one of these calls `laam-api`'s admin category/menu-item endpoints
 * (proxied through this app's `/api/admin/[...slug]` BFF route) and, per
 * that handler group's actual response shape (see `router.go`), gets back
 * the full, refreshed `AppData` bootstrap tree — not just the
 * created/updated resource. Callers write that straight into
 * `bootstrapKeys.all` instead of a second round trip.
 */

export function createCategory(input: CreateCategoryInput): Promise<AppData> {
  return fetchJson<AppData>(CATEGORIES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateCategoryVisibility(id: string, isVisible: boolean): Promise<AppData> {
  return fetchJson<AppData>(`${CATEGORIES_PATH}/${id}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isVisible }),
  });
}

export function deleteCategory(id: string): Promise<AppData> {
  return fetchJson<AppData>(`${CATEGORIES_PATH}/${id}`, { method: "DELETE" });
}

export function createMenuItem(input: CreateMenuItemInput): Promise<AppData> {
  return fetchJson<AppData>(MENU_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateMenuItemVisibility(id: string, isVisible: boolean): Promise<AppData> {
  return fetchJson<AppData>(`${MENU_ITEMS_PATH}/${id}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isVisible }),
  });
}

export function deleteMenuItem(id: string): Promise<AppData> {
  return fetchJson<AppData>(`${MENU_ITEMS_PATH}/${id}`, { method: "DELETE" });
}

/**
 * `colors[0]` is the operator's color for the item's first Toss label,
 * `colors[1]` for its second, and so on — matching `MenuItem.labels`'
 * position order. It never sends label text: that always comes from Toss's
 * own catalog sync (see `laam-api`'s `UpdateMenuItemLabelColors`).
 */
export function updateMenuItemLabelColors(id: string, colors: string[]): Promise<AppData> {
  return fetchJson<AppData>(`${MENU_ITEMS_PATH}/${id}/label-colors`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colors }),
  });
}

/**
 * Multipart upload to `POST /api/v1/admin/menu-items/{id}/images`. The
 * field names (`image`, `isPrimary`, `displayArea`, `focusX`, `focusY`)
 * match that handler's `r.FormFile("image")`/`r.FormValue(...)` calls
 * exactly. `Content-Type` is deliberately left unset so the browser adds
 * the multipart boundary itself — `fetchJson` just forwards `init` to
 * `fetch`.
 */
export function uploadMenuItemImage(input: UploadMenuItemImageInput): Promise<AppData> {
  const formData = new FormData();
  formData.append("image", input.image);
  formData.append("isPrimary", String(input.isPrimary));
  formData.append("displayArea", input.displayArea);
  formData.append("focusX", String(input.focusX));
  formData.append("focusY", String(input.focusY));

  return fetchJson<AppData>(`${MENU_ITEMS_PATH}/${input.menuItemId}/images`, {
    method: "POST",
    body: formData,
  });
}

/**
 * GETs `laam-api`'s admin-only recipe subresource for a menu item
 * (`GET /api/v1/admin/menu-items/{id}/recipe`). Unlike every mutation
 * above, this — and `updateMenuItemRecipe` below — return just the
 * `MenuItemRecipe` object, not the full `AppData` bootstrap tree: recipe
 * text is never part of the public bootstrap/menu contract.
 */
export function getMenuItemRecipe(menuItemId: string): Promise<MenuItemRecipe> {
  return fetchJson<MenuItemRecipe>(`${MENU_ITEMS_PATH}/${menuItemId}/recipe`);
}

export function updateMenuItemRecipe(
  menuItemId: string,
  input: UpdateMenuItemRecipeInput,
): Promise<MenuItemRecipe> {
  return fetchJson<MenuItemRecipe>(`${MENU_ITEMS_PATH}/${menuItemId}/recipe`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Manually triggers `laam-api`'s Toss Place catalog sync — the server only
 * otherwise runs this once, at startup, so this is how an operator gets
 * the latest POS data without restarting it.
 * Unlike every other call in this module, the response isn't `AppData`
 * directly — it's `{ created, linked, updated, data }`, so the operator's
 * "다시 동기화" button can show the counts alongside refreshing the list
 * (see `CatalogSyncResponse`'s doc comment).
 */
export function resyncCatalog(): Promise<CatalogSyncResponse> {
  return fetchJson<CatalogSyncResponse>(CATALOG_SYNC_PATH, { method: "POST" });
}
