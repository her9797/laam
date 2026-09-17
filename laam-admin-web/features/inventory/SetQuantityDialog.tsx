"use client";

import "@/i18n/client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

import { parseQuantity, type InventoryItem } from "./model";
import { useSetInventoryQuantityMutation } from "./queries";

/** "지금 남은 수량" — replaces the quantity with a counted value. */
export function SetQuantityDialog({
  item,
  waitForPending,
  onOpenChange,
}: {
  item: InventoryItem | null;
  waitForPending?: (itemId: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {item ? (
          <SetQuantityForm
            key={item.id}
            item={item}
            waitForPending={waitForPending}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SetQuantityForm({
  item,
  waitForPending,
  onDone,
}: {
  item: InventoryItem;
  waitForPending?: (itemId: string) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useTranslation("inventory");
  const inputId = useId();
  const mutation = useSetInventoryQuantityMutation(waitForPending);
  const [value, setValue] = useState(item.quantity >= 0 ? String(item.quantity) : "");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = parseQuantity(value);
    if (quantity === null) {
      setErrorKey("errorQuantityInvalid");
      return;
    }
    setErrorKey(null);
    mutation.mutate(
      { id: item.id, quantity },
      {
        onSuccess: (updated) => {
          toast.add({
            type: "success",
            title: t("setQuantitySaved", {
              name: updated.name,
              quantity: updated.quantity,
              unit: updated.unit,
            }),
          });
          onDone();
        },
        onError: () => setErrorKey("setQuantityFailed"),
      },
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>{t("setQuantityTitle")}</DialogTitle>
        <DialogDescription>
          {t("setQuantityDescription", { name: item.name, unit: item.unit })}
        </DialogDescription>
      </DialogHeader>
      <Field data-invalid={Boolean(errorKey) || undefined}>
        <FieldLabel htmlFor={inputId}>{t("setQuantityLabel")}</FieldLabel>
        <Input
          id={inputId}
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={Boolean(errorKey)}
          className="h-11 text-base"
        />
        {errorKey ? (
          <FieldError>
            <p>{t(errorKey)}</p>
            {errorKey === "setQuantityFailed" && mutation.error instanceof Error ? (
              <p>{mutation.error.message}</p>
            ) : null}
          </FieldError>
        ) : null}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:cancel")}
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {t("common:save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
