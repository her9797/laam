import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AppData } from "@/features/bootstrap/model";
import { bootstrapKeys } from "@/features/bootstrap/queries";

import {
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  getMenuItemRecipe,
  resyncCatalog,
  updateCategoryVisibility,
  updateMenuItemLabelColors,
  updateMenuItemRecipe,
  updateMenuItemVisibility,
  uploadMenuItemImage,
} from "./api";
import type {
  CreateCategoryInput,
  CreateMenuItemInput,
  UpdateMenuItemRecipeInput,
  UploadMenuItemImageInput,
} from "./model";

/**
 * Every mutation here touches categories/menu items, which live in the
 * shared `AppData` bootstrap tree (Task 4's design) — so every one of them
 * writes its response into `bootstrapKeys.all` only, never
 * `requestsKeys.all`/`specialRequestKeys.all`.
 */
function useApplyBootstrapUpdate() {
  const queryClient = useQueryClient();
  return (appData: AppData) => {
    queryClient.setQueryData(bootstrapKeys.all, appData);
  };
}

export function useCreateCategoryMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) => createCategory(input),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useUpdateCategoryVisibilityMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      updateCategoryVisibility(id, isVisible),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useDeleteCategoryMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useCreateMenuItemMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: (input: CreateMenuItemInput) => createMenuItem(input),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useUpdateMenuItemVisibilityMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      updateMenuItemVisibility(id, isVisible),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useUpdateMenuItemLabelColorsMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: ({ id, colors }: { id: string; colors: string[] }) =>
      updateMenuItemLabelColors(id, colors),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useDeleteMenuItemMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: (id: string) => deleteMenuItem(id),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useUploadMenuItemImageMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: (input: UploadMenuItemImageInput) => uploadMenuItemImage(input),
    onSuccess: applyBootstrapUpdate,
  });
}

/**
 * Unlike the mutations above, `resyncCatalog`'s response isn't `AppData`
 * directly — it's `{ created, linked, updated, data }` — so this pulls
 * `.data` out before writing to `bootstrapKeys.all`, same destination,
 * same reasoning.
 */
export function useResyncCatalogMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: () => resyncCatalog(),
    onSuccess: (response) => applyBootstrapUpdate(response.data),
  });
}

/**
 * Recipe text is admin-only and never part of the `AppData` bootstrap tree
 * (see `MenuItemRecipe`'s doc comment in `./model`), so it gets its own
 * query key here rather than living under `bootstrapKeys.all`.
 */
export const menuItemRecipeKeys = {
  detail: (menuItemId: string) => ["menu-item-recipe", menuItemId] as const,
};

export function useMenuItemRecipeQuery(menuItemId: string) {
  return useQuery({
    queryKey: menuItemRecipeKeys.detail(menuItemId),
    queryFn: () => getMenuItemRecipe(menuItemId),
    enabled: menuItemId.length > 0,
  });
}

export function useUpdateMenuItemRecipeMutation(menuItemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMenuItemRecipeInput) => updateMenuItemRecipe(menuItemId, input),
    onSuccess: (recipe) => {
      queryClient.setQueryData(menuItemRecipeKeys.detail(menuItemId), recipe);
    },
  });
}
