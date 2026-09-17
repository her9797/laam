"use client";

import "@/i18n/client";

import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FetchJsonError } from "@/lib/api/fetch-json";

import { isImageStorageUnavailable } from "./api";
import { useReceiptImageUrlQuery } from "./queries";

/** Shows a receipt photo through a short-lived signed URL. */
export function ReceiptImageDialog({
  receiptId,
  onOpenChange,
}: {
  receiptId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("expenses");
  const query = useReceiptImageUrlQuery(receiptId);

  let content: React.ReactNode;
  if (query.isLoading) {
    content = <p className="text-sm text-muted-foreground">{t("imageLoading")}</p>;
  } else if (query.isError) {
    const error = query.error;
    content = (
      <p className="text-sm text-destructive">
        {isImageStorageUnavailable(error)
          ? t("photoUnavailable")
          : error instanceof FetchJsonError && error.status === 404
            ? t("imageNotFound")
            : t("imageError")}
      </p>
    );
  } else if (query.data) {
    content = (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL, not an optimizable asset
      <img
        src={query.data.url}
        alt={t("imageAlt")}
        className="max-h-[70vh] w-full rounded-2xl object-contain"
      />
    );
  }

  return (
    <Dialog open={receiptId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("imageDialogTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("imageDialogTitle")}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
