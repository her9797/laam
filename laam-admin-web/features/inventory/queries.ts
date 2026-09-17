"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { toast } from "@/components/ui/toast";

import {
  adjustInventoryItem,
  createExpenseCategory,
  createInventoryItem,
  listExpenseCategories,
  listInventoryAdjustments,
  listInventoryItems,
  renameExpenseCategory,
  updateInventoryItem,
} from "./api";
import {
  withQuantity,
  type CreateInventoryItemInput,
  type InventoryItem,
  type UpdateInventoryItemInput,
} from "./model";

export const inventoryKeys = {
  all: ["inventory"] as const,
  lists: () => [...inventoryKeys.all, "items"] as const,
  list: (includeArchived: boolean) => [...inventoryKeys.lists(), { includeArchived }] as const,
  adjustments: (itemId: string) => [...inventoryKeys.all, "adjustments", itemId] as const,
};

export const expenseCategoryKeys = {
  all: ["expenseCategories"] as const,
};

export const ADJUST_DEBOUNCE_MS = 600;
const ADJUSTMENT_HISTORY_LIMIT = 20;

export function useExpenseCategoriesQuery() {
  return useQuery({
    queryKey: expenseCategoryKeys.all,
    queryFn: listExpenseCategories,
  });
}

export function useInventoryItemsQuery(includeArchived = false) {
  return useQuery({
    queryKey: inventoryKeys.list(includeArchived),
    queryFn: () => listInventoryItems(includeArchived),
  });
}

export function useInventoryAdjustmentsQuery(itemId: string | null) {
  return useQuery({
    queryKey: inventoryKeys.adjustments(itemId ?? ""),
    queryFn: () => listInventoryAdjustments(itemId ?? "", ADJUSTMENT_HISTORY_LIMIT),
    enabled: itemId !== null,
  });
}

function mapCachedItems(
  queryClient: QueryClient,
  itemId: string,
  update: (item: InventoryItem) => InventoryItem,
) {
  queryClient.setQueriesData<InventoryItem[]>({ queryKey: inventoryKeys.lists() }, (items) =>
    items?.map((item) => (item.id === itemId ? update(item) : item)),
  );
}

export function useCreateExpenseCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createExpenseCategory(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: expenseCategoryKeys.all }),
  });
}

export function useRenameExpenseCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameExpenseCategory(id, name),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: expenseCategoryKeys.all }),
        // `expenseKeys.all` (features/expenses/queries.ts, which imports this
        // module): the expense summary carries category names.
        queryClient.invalidateQueries({ queryKey: ["expenses"] }),
      ]),
  });
}

export function useCreateInventoryItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInventoryItemInput) => createInventoryItem(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() }),
  });
}

export function useUpdateInventoryItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateInventoryItemInput }) =>
      updateInventoryItem(id, input),
    onSuccess: (updated) => {
      mapCachedItems(queryClient, updated.id, () => updated);
      // Archiving moves an item between the archived/unarchived lists and
      // changes the server's order, so re-fetch rather than patch in place.
      return queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
    },
  });
}

export function useSetInventoryQuantityMutation(waitForPending?: (itemId: string) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      await waitForPending?.(id);
      return adjustInventoryItem(id, { set: quantity });
    },
    onSuccess: (updated) => {
      mapCachedItems(queryClient, updated.id, () => updated);
      return queryClient.invalidateQueries({ queryKey: inventoryKeys.adjustments(updated.id) });
    },
  });
}

type StepTarget = Pick<InventoryItem, "id" | "name">;

type Translate = (key: string, options?: Record<string, unknown>) => string;

type PendingStep = {
  delta: number;
  name: string;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * The −/+ buttons on the inventory screen. Each tap changes the cached
 * quantity right away; taps on the same item within `ADJUST_DEBOUNCE_MS` are
 * summed and sent as a single `{delta}` adjust.
 *
 * Requests for one item are sent one after another, and every delta not yet
 * confirmed by the server is tracked in `unconfirmed`, so a response for an
 * earlier request is written back with the later local taps still on top
 * (it cannot already include them). A failed request removes only its own
 * delta from the cache. Success toasts offer an undo that sends the opposite
 * delta straight away.
 */
function createQuantityAdjuster(queryClient: QueryClient, translate: Translate) {
  const pending = new Map<string, PendingStep>();
  const unconfirmed = new Map<string, number>();
  const chains = new Map<string, Promise<void>>();

  function addUnconfirmed(itemId: string, delta: number) {
    const next = (unconfirmed.get(itemId) ?? 0) + delta;
    if (next === 0) {
      unconfirmed.delete(itemId);
    } else {
      unconfirmed.set(itemId, next);
    }
  }

  function applyLocal(itemId: string, delta: number) {
    addUnconfirmed(itemId, delta);
    mapCachedItems(queryClient, itemId, (item) => withQuantity(item, item.quantity + delta));
  }

  async function run(target: StepTarget, delta: number, isUndo: boolean) {
    try {
      const updated = await adjustInventoryItem(target.id, { delta });
      addUnconfirmed(target.id, -delta);
      const stillLocal = unconfirmed.get(target.id) ?? 0;
      mapCachedItems(queryClient, target.id, () => withQuantity(updated, updated.quantity + stillLocal));
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.adjustments(target.id) });
      if (isUndo) {
        toast.add({ type: "success", title: translate("adjustUndone", { name: updated.name }) });
        return;
      }
      toast.add({
        type: "success",
        title: translate("adjustSaved", {
          name: updated.name,
          quantity: updated.quantity,
          unit: updated.unit,
        }),
        actionProps: {
          children: translate("undo"),
          onClick: () => {
            applyLocal(target.id, -delta);
            send(target, -delta, true);
          },
        },
      });
    } catch (error) {
      // Takes the failed delta back out of both the cache and `unconfirmed`.
      applyLocal(target.id, -delta);
      toast.add({
        type: "error",
        title: translate("adjustFailed", { name: target.name }),
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  function send(target: StepTarget, delta: number, isUndo: boolean) {
    const previous = chains.get(target.id) ?? Promise.resolve();
    const next = previous.then(() => run(target, delta, isUndo));
    chains.set(target.id, next);
    void next.finally(() => {
      if (chains.get(target.id) === next) {
        chains.delete(target.id);
      }
    });
  }

  function flush(itemId: string) {
    const entry = pending.get(itemId);
    pending.delete(itemId);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    if (entry.delta !== 0) {
      send({ id: itemId, name: entry.name }, entry.delta, false);
    }
  }

  function step(target: StepTarget, delta: number) {
    applyLocal(target.id, delta);
    const previous = pending.get(target.id);
    if (previous) {
      clearTimeout(previous.timer);
    }
    pending.set(target.id, {
      delta: (previous?.delta ?? 0) + delta,
      name: target.name,
      timer: setTimeout(() => flush(target.id), ADJUST_DEBOUNCE_MS),
    });
  }

  function flushAll() {
    for (const itemId of [...pending.keys()]) {
      flush(itemId);
    }
  }

  function flushAndWait(itemId: string): Promise<void> {
    flush(itemId);
    return chains.get(itemId) ?? Promise.resolve();
  }

  return { step, flushAll, flushAndWait };
}

export function useInventoryQuantityAdjuster() {
  const queryClient = useQueryClient();
  const { i18n } = useTranslation("inventory");
  // Translated when each toast is shown, so a language switch while a
  // request is in flight still gets the current language.
  const [adjuster] = useState(() =>
    createQuantityAdjuster(queryClient, (key, options) => i18n.t(key, { ns: "inventory", ...options })),
  );

  // Leaving the screen mid-debounce still saves the taps already shown.
  useEffect(() => () => adjuster.flushAll(), [adjuster]);

  return { step: adjuster.step, flushAndWait: adjuster.flushAndWait };
}
