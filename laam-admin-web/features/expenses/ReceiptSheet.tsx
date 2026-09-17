"use client";

import "@/i18n/client";

import { RiAddLine, RiCheckLine, RiCloseLine, RiImageLine, RiSubtractLine } from "@remixicon/react";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { formatNumber, formatSignedDelta } from "@/features/inventory/format";
import { InventoryItemCombobox } from "@/features/inventory/InventoryItemCombobox";
import type { InventoryItem } from "@/features/inventory/model";
import { useExpenseCategoriesQuery, useInventoryItemsQuery } from "@/features/inventory/queries";
import { cn } from "@/lib/utils";

import { uploadReceiptImageSafely } from "./api";
import { resizeReceiptImage } from "./image";
import {
  MEMO_MAX_LENGTH,
  PAYMENT_METHOD_LABEL_KEYS,
  PAYMENT_METHODS,
  RECEIPT_MAX_LINES,
  VENDOR_MAX_LENGTH,
  calculateDraftTotal,
  diffInventoryQuantities,
  formatAmountInput,
  parseAmountInput,
  recentVendors,
  seoulMonth,
  seoulToday,
  shiftMonth,
  type DraftLine,
  type ExpenseReceipt,
  type ExpenseReceiptInput,
  type PaymentMethod,
} from "./model";
import { readLastPaymentMethod, rememberPaymentMethod } from "./payment-method";
import {
  invalidateAfterReceiptChange,
  useDeleteExpenseReceiptMutation,
  useExpenseReceiptsQuery,
  useSaveExpenseReceiptMutation,
} from "./queries";

const RECENT_VENDOR_LIMIT = 6;
const DEFAULT_OTHER_CATEGORY_ID = "other";

type ReceiptSheetProps = {
  open: boolean;
  /** Present when editing; `null` when adding. */
  receipt: ExpenseReceipt | null;
  onOpenChange: (open: boolean) => void;
  onViewPhoto: (receiptId: string) => void;
};

/**
 * Add/edit sheet for one receipt: full screen on a phone, a right-hand
 * panel on a wider screen.
 */
export function ReceiptSheet({ open, receipt, onOpenChange, onViewPhoto }: ReceiptSheetProps) {
  const { t } = useTranslation("expenses");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 data-[side=right]:w-full sm:max-w-lg">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>{receipt ? t("sheetEditTitle") : t("sheetCreateTitle")}</SheetTitle>
          <SheetDescription>{t("sheetDescription")}</SheetDescription>
        </SheetHeader>
        {open ? (
          <ReceiptForm
            key={receipt?.id ?? "new"}
            receipt={receipt}
            onDone={() => onOpenChange(false)}
            onViewPhoto={onViewPhoto}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

let lineKeySequence = 0;
function nextLineKey(): string {
  lineKeySequence += 1;
  return `line-${lineKeySequence}`;
}

function newItemLine(): DraftLine {
  return { key: nextLineKey(), kind: "item", itemId: null, quantity: 1, amount: "" };
}

function newOtherLine(categoryId: string | null): DraftLine {
  return { key: nextLineKey(), kind: "other", categoryId, description: "", amount: "" };
}

function toDraftLines(receipt: ExpenseReceipt): DraftLine[] {
  return receipt.lines.map((line) =>
    line.itemId !== null
      ? {
          key: nextLineKey(),
          kind: "item",
          itemId: line.itemId,
          itemName: line.itemName,
          quantity: line.quantity ?? 1,
          amount: formatAmountInput(String(line.amount)),
        }
      : {
          key: nextLineKey(),
          kind: "other",
          categoryId: line.categoryId,
          description: line.description,
          amount: formatAmountInput(String(line.amount)),
        },
  );
}

type LineErrors = Partial<Record<"item" | "quantity" | "category" | "description" | "amount", string>>;

type FormErrors = {
  date?: string;
  lines?: string;
  byLine: Record<string, LineErrors>;
};

type InventoryChange = { itemId: string; delta: number };

type Confirmation =
  | { kind: "save"; input: ExpenseReceiptInput; changes: InventoryChange[] }
  | { kind: "delete"; changes: InventoryChange[] };

function inputQuantityLines(input: ExpenseReceiptInput) {
  return input.lines.map((line) =>
    "itemId" in line ? { itemId: line.itemId, quantity: line.quantity } : { itemId: null, quantity: null },
  );
}

function ReceiptForm({
  receipt,
  onDone,
  onViewPhoto,
}: {
  receipt: ExpenseReceipt | null;
  onDone: () => void;
  onViewPhoto: (receiptId: string) => void;
}) {
  const { t, i18n } = useTranslation("expenses");
  const language = i18n.language;
  const idPrefix = useId();
  const queryClient = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const categoriesQuery = useExpenseCategoriesQuery();
  const itemsQuery = useInventoryItemsQuery(false);
  const [today] = useState(() => new Date());
  const currentMonthReceipts = useExpenseReceiptsQuery(seoulMonth(today));
  const previousMonthReceipts = useExpenseReceiptsQuery(shiftMonth(seoulMonth(today), -1));
  const saveMutation = useSaveExpenseReceiptMutation();
  const deleteMutation = useDeleteExpenseReceiptMutation();

  const [date, setDate] = useState(receipt?.date ?? seoulToday(today));
  const [vendor, setVendor] = useState(receipt?.vendor ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    () => receipt?.paymentMethod ?? readLastPaymentMethod(),
  );
  const [memo, setMemo] = useState(receipt?.memo ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() => (receipt ? toDraftLines(receipt) : [newItemLine()]));
  const [photo, setPhoto] = useState<File | null>(null);
  // Items picked in this form, so a just-created item already has its unit.
  const [pickedItems, setPickedItems] = useState<Record<string, InventoryItem>>({});
  const [errors, setErrors] = useState<FormErrors>({ byLine: {} });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const categories = categoriesQuery.data ?? [];
  const items = new Map((itemsQuery.data ?? []).map((item) => [item.id, item]));
  const findItem = (itemId: string | null) =>
    itemId === null ? undefined : (pickedItems[itemId] ?? items.get(itemId));
  const vendorSuggestions = recentVendors(
    [...(currentMonthReceipts.data ?? []), ...(previousMonthReceipts.data ?? [])],
    RECENT_VENDOR_LIMIT,
  );
  const total = calculateDraftTotal(lines);
  const isBusy = saveMutation.isPending || deleteMutation.isPending || isUploading;

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? ({ ...line, ...patch } as DraftLine) : line)),
    );
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  function validate(): ExpenseReceiptInput | null {
    const next: FormErrors = { byLine: {} };
    if (!date) next.date = "errorDateRequired";
    if (lines.length === 0) next.lines = "errorLinesRequired";

    const inputLines: ExpenseReceiptInput["lines"] = [];
    for (const line of lines) {
      const lineErrors: LineErrors = {};
      const amount = parseAmountInput(line.amount);
      if (amount === null) lineErrors.amount = "errorAmountRequired";
      if (line.kind === "item") {
        if (!line.itemId) lineErrors.item = "errorItemRequired";
        if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
          lineErrors.quantity = "errorQuantityInvalid";
        }
        if (line.itemId && amount !== null && !lineErrors.quantity) {
          inputLines.push({ itemId: line.itemId, quantity: line.quantity, amount });
        }
      } else {
        if (!line.categoryId) lineErrors.category = "errorCategoryRequired";
        if (!line.description.trim()) lineErrors.description = "errorDescriptionRequired";
        if (line.categoryId && line.description.trim() && amount !== null) {
          inputLines.push({ categoryId: line.categoryId, description: line.description.trim(), amount });
        }
      }
      if (Object.keys(lineErrors).length > 0) {
        next.byLine[line.key] = lineErrors;
      }
    }

    setErrors(next);
    if (next.date || next.lines || Object.keys(next.byLine).length > 0) {
      return null;
    }
    return { date, vendor: vendor.trim(), paymentMethod, memo: memo.trim(), lines: inputLines };
  }

  async function uploadPhoto(receiptId: string) {
    if (!photo) return;
    setIsUploading(true);
    try {
      let resized: File;
      try {
        resized = await resizeReceiptImage(photo);
      } catch (error) {
        toast.add({
          type: "error",
          title: t("photoUploadFailed"),
          description: error instanceof Error ? error.message : undefined,
        });
        return;
      }
      const result = await uploadReceiptImageSafely(receiptId, resized);
      if (result.status === "unavailable") {
        toast.add({ type: "warning", title: t("photoUnavailable"), description: t("photoUnavailableDescription") });
      } else if (result.status === "failed") {
        toast.add({
          type: "error",
          title: t("photoUploadFailed"),
          description: result.error instanceof Error ? result.error.message : undefined,
        });
      } else {
        void invalidateAfterReceiptChange(queryClient);
      }
    } finally {
      setIsUploading(false);
    }
  }

  function save(input: ExpenseReceiptInput) {
    setSubmitError(null);
    const changes = diffInventoryQuantities(receipt?.lines ?? [], inputQuantityLines(input));
    saveMutation.mutate(
      { id: receipt?.id ?? null, input },
      {
        onSuccess: async (saved) => {
          rememberPaymentMethod(input.paymentMethod);
          toast.add({
            type: "success",
            title:
              changes.length > 0
                ? t("savedToastWithInventory", { count: changes.length })
                : t("savedToast"),
          });
          await uploadPhoto(saved.id);
          onDone();
        },
        onError: (error) => setSubmitError(error instanceof Error ? error.message : ""),
      },
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = validate();
    if (!input) return;
    if (receipt) {
      setConfirmation({
        kind: "save",
        input,
        changes: diffInventoryQuantities(receipt.lines, inputQuantityLines(input)),
      });
      return;
    }
    save(input);
  }

  function handleConfirm() {
    if (!confirmation) return;
    if (confirmation.kind === "save") {
      setConfirmation(null);
      save(confirmation.input);
      return;
    }
    if (!receipt) return;
    const changes = confirmation.changes;
    setConfirmation(null);
    deleteMutation.mutate(receipt.id, {
      onSuccess: () => {
        toast.add({
          type: "success",
          title:
            changes.length > 0
              ? t("deletedToastWithInventory", { count: changes.length })
              : t("deletedToast"),
        });
        onDone();
      },
      onError: (error) =>
        toast.add({
          type: "error",
          title: t("deleteFailed"),
          description: error instanceof Error ? error.message : undefined,
        }),
    });
  }

  function changeLabel(change: InventoryChange) {
    const item = findItem(change.itemId);
    const name =
      item?.name ?? receipt?.lines.find((line) => line.itemId === change.itemId)?.itemName ?? t("unknownItem");
    return { name, delta: t("inventoryDelta", { delta: formatSignedDelta(change.delta, language), unit: item?.unit ?? "" }) };
  }

  const ids = {
    date: `${idPrefix}-date`,
    vendor: `${idPrefix}-vendor`,
    memo: `${idPrefix}-memo`,
    photo: `${idPrefix}-photo`,
  };
  const hasLineErrors = Object.keys(errors.byLine).length > 0;

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit} noValidate>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        <FieldGroup className="gap-5">
          <Field data-invalid={Boolean(errors.date) || undefined}>
            <FieldLabel htmlFor={ids.date}>{t("dateLabel")}</FieldLabel>
            <Input
              id={ids.date}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              aria-invalid={Boolean(errors.date)}
              className="h-11"
            />
            {errors.date ? <FieldError>{t(errors.date)}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor={ids.vendor}>{t("vendorLabel")}</FieldLabel>
            <Input
              id={ids.vendor}
              value={vendor}
              maxLength={VENDOR_MAX_LENGTH}
              onChange={(event) => setVendor(event.target.value)}
              placeholder={t("vendorPlaceholder")}
              autoComplete="off"
              className="h-11"
            />
            {vendorSuggestions.length > 0 ? (
              <div role="group" aria-label={t("recentVendors")} className="flex flex-wrap gap-2">
                {vendorSuggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    size="sm"
                    variant={vendor.trim() === suggestion ? "secondary" : "outline"}
                    aria-pressed={vendor.trim() === suggestion}
                    onClick={() => setVendor(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            ) : null}
          </Field>

          <FieldSet className="gap-2">
            <FieldLegend variant="label" className="mb-1">
              {t("paymentMethodLabel")}
            </FieldLegend>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((method) => (
                <Button
                  key={method}
                  type="button"
                  variant={paymentMethod === method ? "secondary" : "outline"}
                  aria-pressed={paymentMethod === method}
                  className="h-11 min-w-20"
                  onClick={() => setPaymentMethod(method)}
                >
                  {paymentMethod === method ? <RiCheckLine data-icon="inline-start" aria-hidden="true" /> : null}
                  {t(PAYMENT_METHOD_LABEL_KEYS[method])}
                </Button>
              ))}
            </div>
          </FieldSet>
        </FieldGroup>

        <FieldSet className="gap-3">
          <FieldLegend variant="label" className="mb-0">
            {t("linesLabel")}
          </FieldLegend>
          <ul className="flex flex-col gap-3">
            {lines.map((line, index) => {
              const lineErrors = errors.byLine[line.key] ?? {};
              const lineMessages = Object.values(lineErrors);
              return (
                <li key={line.key}>
                  <div
                    role="group"
                    aria-label={t(line.kind === "item" ? "itemLineLabel" : "otherLineLabel", { index: index + 1 })}
                    className={cn(
                      "flex flex-col gap-2 rounded-2xl border border-border p-3",
                      lineMessages.length > 0 && "border-destructive",
                    )}
                  >
                    {line.kind === "item" ? (
                      <ItemLineFields
                        line={line}
                        fallbackItemName={line.itemName}
                        index={index}
                        errors={lineErrors}
                        item={findItem(line.itemId)}
                        onChange={(patch) => updateLine(line.key, patch)}
                        onPick={(item) => {
                          setPickedItems((current) => ({ ...current, [item.id]: item }));
                          updateLine(line.key, { itemId: item.id });
                        }}
                        onRemove={() => removeLine(line.key)}
                      />
                    ) : (
                      <OtherLineFields
                        line={line}
                        index={index}
                        errors={lineErrors}
                        categories={categories}
                        onChange={(patch) => updateLine(line.key, patch)}
                        onRemove={() => removeLine(line.key)}
                      />
                    )}
                    {lineMessages.length > 0 ? (
                      <FieldError>
                        {lineMessages.map((key) => (
                          <p key={key}>{t(key)}</p>
                        ))}
                      </FieldError>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {errors.lines ? <FieldError>{t(errors.lines)}</FieldError> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={lines.length >= RECEIPT_MAX_LINES}
              onClick={() => setLines((current) => [...current, newItemLine()])}
            >
              <RiAddLine data-icon="inline-start" aria-hidden="true" />
              {t("addItemLine")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={lines.length >= RECEIPT_MAX_LINES}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  newOtherLine(
                    categories.some((category) => category.id === DEFAULT_OTHER_CATEGORY_ID)
                      ? DEFAULT_OTHER_CATEGORY_ID
                      : null,
                  ),
                ])
              }
            >
              <RiAddLine data-icon="inline-start" aria-hidden="true" />
              {t("addOtherLine")}
            </Button>
          </div>
        </FieldSet>

        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor={ids.memo}>{t("memoLabel")}</FieldLabel>
            <Textarea
              id={ids.memo}
              value={memo}
              maxLength={MEMO_MAX_LENGTH}
              onChange={(event) => setMemo(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={ids.photo}>{t("photoLabel")}</FieldLabel>
            <input
              ref={photoInputRef}
              id={ids.photo}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                setPhoto(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => photoInputRef.current?.click()}
              >
                <RiImageLine data-icon="inline-start" aria-hidden="true" />
                {photo || receipt?.hasImage ? t("photoChange") : t("photoChoose")}
              </Button>
              {receipt?.hasImage ? (
                <Button type="button" variant="ghost" className="h-11" onClick={() => onViewPhoto(receipt.id)}>
                  {t("viewPhoto")}
                </Button>
              ) : null}
            </div>
            {photo ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="min-w-0 truncate">{t("photoSelected", { name: photo.name })}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                  {t("photoClearSelection")}
                </Button>
              </div>
            ) : receipt?.hasImage ? (
              <p className="text-sm text-muted-foreground">{t("photoReplaceHint")}</p>
            ) : null}
          </Field>
        </FieldGroup>

        {receipt ? (
          <Button
            type="button"
            variant="destructive"
            className="h-11 self-start"
            disabled={isBusy}
            onClick={() => setConfirmation({ kind: "delete", changes: diffInventoryQuantities(receipt.lines, []) })}
          >
            {t("deleteReceipt")}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-border bg-popover p-4">
        {submitError !== null ? (
          <FieldError>
            <p>{t("saveFailed")}</p>
            {submitError ? <p>{submitError}</p> : null}
          </FieldError>
        ) : hasLineErrors ? (
          <FieldError>{t("errorFormInvalid")}</FieldError>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 flex-col">
            <span className="text-xs text-muted-foreground">{t("totalLabel")}</span>
            <span className="text-xl font-bold tabular-nums text-foreground" aria-live="polite">
              {t("amountValue", { amount: formatNumber(total, language) })}
            </span>
          </p>
          <Button type="submit" className="h-11 min-w-28" disabled={isBusy}>
            {t("common:save")}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmation !== null} onOpenChange={(open) => !open && setConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation?.kind === "delete" ? t("confirmDeleteTitle") : t("confirmEditTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation && confirmation.changes.length > 0
                ? t("confirmInventoryChanges")
                : t("confirmNoInventoryChange")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmation && confirmation.changes.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-2xl bg-muted p-3 text-sm">
              {confirmation.changes.map((change) => {
                const label = changeLabel(change);
                return (
                  <li key={change.itemId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-foreground">{label.name}</span>
                    <span
                      className={cn(
                        "shrink-0 font-semibold tabular-nums",
                        change.delta < 0 ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {label.delta}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {confirmation?.kind === "delete" ? (
            <p className="text-sm text-muted-foreground">{t("common:deleteIrreversible")}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation?.kind === "delete" ? "destructive" : "default"}
              onClick={handleConfirm}
            >
              {confirmation?.kind === "delete" ? t("confirmDelete") : t("confirmSave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function AmountInput({
  value,
  onChange,
  invalid,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  label: string;
  className?: string;
}) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="off"
      value={value}
      placeholder="0"
      aria-label={label}
      aria-invalid={invalid}
      onChange={(event) => onChange(formatAmountInput(event.target.value))}
      className={cn("h-11 text-right tabular-nums", className)}
    />
  );
}

function RemoveLineButton({ onRemove, label }: { onRemove: () => void; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={label} onClick={onRemove}>
      <RiCloseLine aria-hidden="true" />
    </Button>
  );
}

function ItemLineFields({
  line,
  fallbackItemName,
  index,
  errors,
  item,
  onChange,
  onPick,
  onRemove,
}: {
  line: Extract<DraftLine, { kind: "item" }>;
  fallbackItemName?: string;
  index: number;
  errors: LineErrors;
  item: InventoryItem | undefined;
  onChange: (patch: Partial<Extract<DraftLine, { kind: "item" }>>) => void;
  onPick: (item: InventoryItem) => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useTranslation("expenses");
  const labelId = useId();
  const language = i18n.language;
  const amount = parseAmountInput(line.amount);
  const unitPriceHint =
    amount !== null && amount > 0 && line.quantity >= 1
      ? t("unitPrice", { price: formatNumber(Math.round(amount / line.quantity), language) })
      : item?.lastUnitPrice != null
        ? t("recentUnitPrice", { price: formatNumber(item.lastUnitPrice, language) })
        : null;
  const lineName = t("itemLineLabel", { index: index + 1 });

  return (
    <>
      <div className="flex items-center gap-1">
        <span id={labelId} className="sr-only">
          {t("itemLabel")}
        </span>
        <div className="min-w-0 flex-1">
          <InventoryItemCombobox
            value={line.itemId}
            fallbackLabel={fallbackItemName}
            labelId={labelId}
            invalid={Boolean(errors.item)}
            onChange={onPick}
          />
        </div>
        <RemoveLineButton onRemove={onRemove} label={`${t("removeLine")} · ${lineName}`} />
      </div>
      <div className="flex items-start gap-2">
        <div role="group" aria-label={t("quantityLabel")} className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            aria-label={t("decreaseQuantity")}
            disabled={line.quantity <= 1}
            onClick={() => onChange({ quantity: Math.max(1, line.quantity - 1) })}
          >
            <RiSubtractLine aria-hidden="true" />
          </Button>
          <Input
            inputMode="numeric"
            aria-label={t("quantityLabel")}
            aria-invalid={Boolean(errors.quantity)}
            value={line.quantity === 0 ? "" : String(line.quantity)}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "");
              onChange({ quantity: digits === "" ? 0 : Number(digits) });
            }}
            className="h-11 w-12 px-1 text-center tabular-nums"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            aria-label={t("increaseQuantity")}
            onClick={() => onChange({ quantity: line.quantity + 1 })}
          >
            <RiAddLine aria-hidden="true" />
          </Button>
          {item?.unit ? <span className="text-xs text-muted-foreground">{item.unit}</span> : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
          <AmountInput
            value={line.amount}
            onChange={(value) => onChange({ amount: value })}
            invalid={Boolean(errors.amount)}
            label={t("amountLabel")}
            className="w-full"
          />
          {unitPriceHint ? <span className="text-xs text-muted-foreground">{unitPriceHint}</span> : null}
        </div>
      </div>
    </>
  );
}

function OtherLineFields({
  line,
  index,
  errors,
  categories,
  onChange,
  onRemove,
}: {
  line: Extract<DraftLine, { kind: "other" }>;
  index: number;
  errors: LineErrors;
  categories: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<Extract<DraftLine, { kind: "other" }>>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("expenses");
  const lineName = t("otherLineLabel", { index: index + 1 });

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Native select, like the item form: it opens the phone's own picker
            and needs no floating popup inside the sheet. */}
        <select
          aria-label={t("categoryLabel")}
          className="h-11 min-w-0 flex-1 rounded-3xl border border-transparent bg-input/50 px-3 text-sm text-foreground aria-invalid:border-destructive"
          value={line.categoryId ?? ""}
          aria-invalid={Boolean(errors.category)}
          onChange={(event) => onChange({ categoryId: event.target.value || null })}
        >
          <option value="">{t("categoryPlaceholder")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <RemoveLineButton onRemove={onRemove} label={`${t("removeLine")} · ${lineName}`} />
      </div>
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("descriptionLabel")}
          aria-invalid={Boolean(errors.description)}
          value={line.description}
          placeholder={t("descriptionPlaceholder")}
          autoComplete="off"
          onChange={(event) => onChange({ description: event.target.value })}
          className="h-11 min-w-0 flex-1"
        />
        <AmountInput
          value={line.amount}
          onChange={(value) => onChange({ amount: value })}
          invalid={Boolean(errors.amount)}
          label={t("amountLabel")}
          className="w-32"
        />
      </div>
    </>
  );
}
