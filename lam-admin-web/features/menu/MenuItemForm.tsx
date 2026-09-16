"use client";

import "@/i18n/client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { AppData, MenuCategory } from "@/features/bootstrap/model";

import {
  UPLOAD_FOCUS_CENTER,
  createInitialCropTransform,
  cropImageFileToSquare,
  loadImageNaturalSize,
  type CropTransform,
} from "./crop";
import { ImageCropEditor } from "./ImageCropEditor";
import { validateImageFile, validateMenuItemForm, type MenuItemFormErrors } from "./model";
import { useCreateMenuItemMutation, useUploadMenuItemImageMutation } from "./queries";

type PendingImage = {
  file: File;
  imageUrl: string;
  transform: CropTransform;
};

type MenuItemFormState = {
  categoryId: string;
  badge: string;
  badgeColor: string;
  name: string;
  description: string;
  price: string;
  isVisible: boolean;
};

// Mirrors the fixed badge-color palette already in use for the customer
// menu (`lam-web/components/screens/admin-screen.tsx`'s `badgeColorOptions`)
// — `badgeColor` is a free-form string on the wire, but the operator picks
// from this known set rather than typing a raw value. Exported: also used
// by `MenuManagementPage`'s per-label color pickers, the same palette.
export const BADGE_COLOR_OPTIONS = [
  { value: "", labelKey: "badgeNone" },
  { value: "green", labelKey: "badgeGreen" },
  { value: "amber", labelKey: "badgeAmber" },
  { value: "pink", labelKey: "badgePink" },
  { value: "blue", labelKey: "badgeBlue" },
] as const;

function emptyForm(categoryId: string): MenuItemFormState {
  return {
    categoryId,
    badge: "",
    badgeColor: "",
    name: "",
    description: "",
    price: "",
    isVisible: true,
  };
}

type MenuItemFormProps = {
  categories: MenuCategory[];
  /**
   * Current menu items, used solely to capture the "before" id set right
   * before creating a new item. `lam-api` generates each item's id itself
   * (`fmt.Sprintf("menu-%d", time.Now().UnixMilli())`,
   * `lam-api/internal/store/postgres.go`) and the create response only
   * returns the full refreshed bootstrap tree, not the new id directly —
   * so the id of the item just created is recovered by diffing this set
   * against the items in that response (same pattern as
   * `lam-web/components/screens/admin-screen.tsx`'s `handleMenuSubmit`).
   * This is what lets an image selected in this form be uploaded to the
   * right item immediately after creation, in one submit.
   */
  items: { id: string }[];
};

export function MenuItemForm({ categories, items }: MenuItemFormProps) {
  const { t } = useTranslation("menu");
  const [form, setForm] = useState<MenuItemFormState>(() => emptyForm(categories[0]?.id ?? ""));
  const [errors, setErrors] = useState<MenuItemFormErrors>({});
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
  // Holds a translation key (from `validateImageFile`, or one raised here),
  // not rendered text, so the message follows a language switch.
  const [imageErrorKey, setImageErrorKey] = useState<string | null>(null);
  const createMutation = useCreateMenuItemMutation();
  const uploadMutation = useUploadMenuItemImageMutation();

  // Derived (not synced via an effect) so the selected category stays
  // valid as the category list changes — e.g. the first category is
  // created after this form already mounted with no categories available.
  const effectiveCategoryId = categories.some((category) => category.id === form.categoryId)
    ? form.categoryId
    : categories[0]?.id ?? "";

  const hasCategories = categories.length > 0;

  function clearPendingImage() {
    setPendingImage((current) => {
      if (current) {
        URL.revokeObjectURL(current.imageUrl);
      }
      return null;
    });
  }

  function openCreateDialog() {
    setForm(emptyForm(effectiveCategoryId));
    setErrors({});
    setImageErrorKey(null);
    clearPendingImage();
    setIsCreateDialogOpen(true);
  }

  function closeCreateDialog() {
    setIsCreateDialogOpen(false);
    clearPendingImage();
  }

  async function handleImageSelected(file: File | undefined) {
    setImageErrorKey(null);
    if (!file) {
      return;
    }

    const validationErrorKey = validateImageFile(file);
    if (validationErrorKey) {
      setImageErrorKey(validationErrorKey);
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    try {
      const { naturalWidth, naturalHeight } = await loadImageNaturalSize(imageUrl);
      setPendingImage({ file, imageUrl, transform: createInitialCropTransform(naturalWidth, naturalHeight) });
      setIsCropDialogOpen(true);
    } catch {
      URL.revokeObjectURL(imageUrl);
      setImageErrorKey("imageLoadFailed");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateMenuItemForm(
      { ...form, categoryId: effectiveCategoryId },
      categories.map((category) => category.id),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    // Captured before the mutation fires so it reflects the item set that
    // existed prior to this create — see the `items` prop doc above.
    const previousItemIds = new Set(items.map((item) => item.id));
    const imageToUpload = pendingImage;

    // The crop (pan AND zoom) is rendered into the uploaded bitmap here,
    // before the item is created, so a failed crop aborts the whole submit
    // instead of leaving a new item with the wrong image. Uploading the
    // original file and describing the crop with `focusX`/`focusY` cannot
    // express zoom at all — see `./crop`'s module doc.
    let croppedImage: File | null = null;
    if (imageToUpload) {
      setImageErrorKey(null);
      try {
        croppedImage = await cropImageFileToSquare(imageToUpload.file, imageToUpload.transform);
      } catch {
        setImageErrorKey("cropFailed");
        return;
      }
    }

    createMutation.mutate(
      {
        categoryId: effectiveCategoryId.trim(),
        badge: form.badge.trim(),
        badgeColor: form.badgeColor.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        price: form.price.trim(),
        isVisible: form.isVisible,
      },
      {
        onSuccess: (appData: AppData) => {
          setForm(emptyForm(effectiveCategoryId));
          clearPendingImage();
          setIsCreateDialogOpen(false);

          if (!croppedImage) {
            return;
          }
          const createdItem = appData.items.find((item) => !previousItemIds.has(item.id));
          if (!createdItem) {
            return;
          }
          uploadMutation.mutate({
            menuItemId: createdItem.id,
            image: croppedImage,
            isPrimary: true,
            displayArea: "menu",
            focusX: UPLOAD_FOCUS_CENTER,
            focusY: UPLOAD_FOCUS_CENTER,
          });
        },
      },
    );
  }

  return (
    <>
      <Button type="button" size="sm" disabled={!hasCategories} onClick={openCreateDialog}>
        {t("itemAdd")}
      </Button>

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeCreateDialog();
          } else {
            setIsCreateDialogOpen(true);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("itemFormTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => void handleSubmit(event)}
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="menu-category">{t("itemCategoryLabel")}</Label>
              <select
                id="menu-category"
                className="h-9 rounded-3xl border border-transparent bg-input/50 px-3 text-sm text-foreground"
                value={effectiveCategoryId}
                onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
                aria-invalid={Boolean(errors.categoryId)}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
              {errors.categoryId ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(errors.categoryId)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="menu-name">{t("itemNameLabel")}</Label>
              <Input
                id="menu-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(errors.name)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="menu-description">{t("itemDescriptionLabel")}</Label>
              <Textarea
                id="menu-description"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="menu-price">{t("itemPriceLabel")}</Label>
              <Input
                id="menu-price"
                value={form.price}
                onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                aria-invalid={Boolean(errors.price)}
              />
              {errors.price ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(errors.price)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="menu-badge">{t("itemBadgeLabel")}</Label>
                <Input
                  id="menu-badge"
                  value={form.badge}
                  onChange={(event) => setForm((current) => ({ ...current, badge: event.target.value }))}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="menu-badge-color">{t("itemBadgeColorLabel")}</Label>
                <select
                  id="menu-badge-color"
                  className="h-9 rounded-3xl border border-transparent bg-input/50 px-3 text-sm text-foreground"
                  value={form.badgeColor}
                  onChange={(event) => setForm((current) => ({ ...current, badgeColor: event.target.value }))}
                >
                  {BADGE_COLOR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isVisible}
                onChange={(event) => setForm((current) => ({ ...current, isVisible: event.target.checked }))}
              />
              {t("common:isPublic")}
            </label>

            <div className="flex flex-col gap-1.5">
              <Label>{t("imageOptionalLabel")}</Label>
              <div className="flex items-center gap-3">
                <label className="cursor-pointer text-sm text-foreground underline underline-offset-4 hover:font-bold">
                  {pendingImage ? t("imageReselect") : t("imageSelect")}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    aria-label={t("imageSelectNewItemAria")}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      void handleImageSelected(file);
                      event.target.value = "";
                    }}
                  />
                </label>
                {pendingImage ? (
                  <>
                    <span className="text-sm text-muted-foreground">{pendingImage.file.name}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => setIsCropDialogOpen(true)}>
                      {t("adjustCrop")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={clearPendingImage}>
                      {t("common:remove")}
                    </Button>
                  </>
                ) : null}
              </div>
              {imageErrorKey ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(imageErrorKey)}
                </p>
              ) : null}
            </div>

            {createMutation.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : t("itemCreateFailed")}
              </p>
            ) : null}

            {uploadMutation.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {t("imageUploadAfterCreateFailed")}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeCreateDialog}>
                {t("common:cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {t("common:save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCropDialogOpen}
        onOpenChange={(open) => {
          setIsCropDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cropDialogTitle")}</DialogTitle>
          </DialogHeader>
          {pendingImage ? (
            <ImageCropEditor
              imageUrl={pendingImage.imageUrl}
              transform={pendingImage.transform}
              onTransformChange={(transform) =>
                setPendingImage((current) => (current ? { ...current, transform } : current))
              }
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                clearPendingImage();
                setIsCropDialogOpen(false);
              }}
            >
              {t("common:cancel")}
            </Button>
            <Button type="button" onClick={() => setIsCropDialogOpen(false)}>
              {t("common:confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
