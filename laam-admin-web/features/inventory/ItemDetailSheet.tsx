"use client";

import "@/i18n/client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";

import { formatDateTime, formatNumber, formatSignedDelta } from "./format";
import { parseQuantity, type InventoryAdjustmentReason, type InventoryItem } from "./model";
import { useInventoryAdjustmentsQuery, useUpdateInventoryItemMutation } from "./queries";

const REASON_KEYS: Record<InventoryAdjustmentReason, string> = {
  purchase: "reasonPurchase",
  receipt_edit: "reasonReceiptEdit",
  receipt_delete: "reasonReceiptDelete",
  manual: "reasonManual",
};

/** Row detail on the inventory screen: history, last price, minimum quantity. */
export function ItemDetailSheet({
  item,
  categoryName,
  onOpenChange,
}: {
  item: InventoryItem | null;
  categoryName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("inventory");

  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:w-full sm:max-w-md">
        {item ? (
          <>
            <SheetHeader>
              <SheetTitle>{item.name}</SheetTitle>
              <SheetDescription>
                {t("detailDescription", { category: categoryName, unit: item.unit })}
              </SheetDescription>
            </SheetHeader>
            <ItemDetailBody key={item.id} item={item} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ItemDetailBody({ item }: { item: InventoryItem }) {
  const { t, i18n } = useTranslation("inventory");
  const language = i18n.language;
  const minInputId = useId();
  const adjustmentsQuery = useInventoryAdjustmentsQuery(item.id);
  const updateMutation = useUpdateInventoryItemMutation();
  const [minQuantity, setMinQuantity] = useState(String(item.minQuantity));
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseQuantity(minQuantity);
    if (parsed === null) {
      setErrorKey("errorMinQuantityInvalid");
      return;
    }
    setErrorKey(null);
    updateMutation.mutate(
      { id: item.id, input: { minQuantity: parsed } },
      {
        onSuccess: () => toast.add({ type: "success", title: t("minQuantitySaved") }),
        onError: () => setErrorKey("saveFailed"),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6 px-6 pb-6">
      <dl className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{t("currentQuantity")}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {t("quantityValue", { quantity: formatNumber(item.quantity, language), unit: item.unit })}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{t("lastUnitPrice")}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {item.lastUnitPrice === null ? (
              <span className="text-sm font-normal text-muted-foreground">{t("lastUnitPriceEmpty")}</span>
            ) : (
              t("priceValue", { price: formatNumber(item.lastUnitPrice, language) })
            )}
          </dd>
        </div>
      </dl>
      {item.needsCheck ? <p className="text-sm text-destructive">{t("needsCheckHint")}</p> : null}

      <form className="flex flex-col gap-2" onSubmit={handleSubmit} noValidate>
        <Field data-invalid={Boolean(errorKey) || undefined}>
          <FieldLabel htmlFor={minInputId}>{t("minQuantityLabel")}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={minInputId}
              inputMode="numeric"
              value={minQuantity}
              onChange={(event) => setMinQuantity(event.target.value)}
              aria-invalid={Boolean(errorKey)}
              className="h-11"
            />
            <Button type="submit" className="h-11" disabled={updateMutation.isPending}>
              {t("common:save")}
            </Button>
          </div>
          <FieldDescription>{t("minQuantityHint")}</FieldDescription>
          {errorKey ? <FieldError>{t(errorKey)}</FieldError> : null}
        </Field>
      </form>

      <Separator />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("historyTitle")}</h3>
        {adjustmentsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("historyLoading")}</p>
        ) : adjustmentsQuery.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-destructive">{t("historyError")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => adjustmentsQuery.refetch()}>
              {t("common:retry")}
            </Button>
          </div>
        ) : (adjustmentsQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(adjustmentsQuery.data ?? []).map((adjustment) => (
              <li key={adjustment.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 flex-col">
                  <span>{t(REASON_KEYS[adjustment.reason])}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(adjustment.createdAt, language)}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums">
                  {t("historyEntry", {
                    delta: formatSignedDelta(adjustment.delta, language),
                    quantityAfter: formatNumber(adjustment.quantityAfter, language),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
