import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/lib/api/fetch-json";

import {
  createMenuLabel,
  deleteMenuLabel,
  getMenuItemRecipe,
  resyncCatalog,
  updateMenuItemContent,
  updateMenuItemLabelColors,
  updateMenuItemRecipe,
  updateMenuLabel,
} from "./api";

vi.mock("@/lib/api/fetch-json", () => ({ fetchJson: vi.fn() }));

describe("resyncCatalog", () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset().mockResolvedValue({
      created: 0,
      linked: 0,
      updated: 0,
      data: { store: {}, categories: [], items: [], requestGuides: [], notices: [] },
    });
  });

  it("POSTs to the admin catalog-sync endpoint", async () => {
    await resyncCatalog();

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/catalog-sync", { method: "POST" });
  });
});

describe("getMenuItemRecipe", () => {
  beforeEach(() => {
    vi.mocked(fetchJson)
      .mockReset()
      .mockResolvedValue({ menuItemId: "menu-1", ingredients: "", instructions: "" });
  });

  it("GETs the admin menu item recipe endpoint", async () => {
    await getMenuItemRecipe("menu-1");

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/menu-items/menu-1/recipe");
  });
});

describe("updateMenuItemRecipe", () => {
  beforeEach(() => {
    vi.mocked(fetchJson)
      .mockReset()
      .mockResolvedValue({ menuItemId: "menu-1", ingredients: "a", instructions: "b" });
  });

  it("PATCHes the admin menu item recipe endpoint with ingredients/instructions", async () => {
    await updateMenuItemRecipe("menu-1", { ingredients: "a", instructions: "b" });

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/menu-items/menu-1/recipe", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients: "a", instructions: "b" }),
    });
  });
});

describe("updateMenuItemLabelColors", () => {
  beforeEach(() => {
    vi.mocked(fetchJson)
      .mockReset()
      .mockResolvedValue({ store: {}, categories: [], items: [], requestGuides: [], notices: [] });
  });

  it("PATCHes the admin menu item label-colors endpoint with a color per position", async () => {
    await updateMenuItemLabelColors("menu-1", ["green", "amber"]);

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/menu-items/menu-1/label-colors", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colors: ["green", "amber"] }),
    });
  });
});

describe("menu label and content endpoints", () => {
  beforeEach(() => {
    vi.mocked(fetchJson)
      .mockReset()
      .mockResolvedValue({ store: {}, categories: [], items: [], requestGuides: [], notices: [] });
  });

  it("POSTs a new label's text and color", async () => {
    await createMenuLabel({ text: "신메뉴", color: "green" });

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/menu-labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "신메뉴", color: "green" }),
    });
  });

  it("PATCHes a label by id", async () => {
    await updateMenuLabel("label-1", { text: "인기", color: "pink" });

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/menu-labels/label-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "인기", color: "pink" }),
    });
  });

  it("DELETEs a label by id", async () => {
    await deleteMenuLabel("label-1");

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/menu-labels/label-1", { method: "DELETE" });
  });

  it("PATCHes a menu item's description override and label ids", async () => {
    await updateMenuItemContent("menu-1", { descriptionOverride: "새 설명", labelIds: ["label-2", "label-1"] });

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/menu-items/menu-1/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descriptionOverride: "새 설명", labelIds: ["label-2", "label-1"] }),
    });
  });
});
