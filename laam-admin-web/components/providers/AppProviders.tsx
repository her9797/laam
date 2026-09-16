"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Toaster } from "@/components/ui/toast";
import { useSyncDocumentLanguage } from "@/i18n/client";
import { createQueryClient } from "@/lib/query/query-client";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  // Corrects `document.documentElement.lang` after hydration for a locale
  // restored from `localStorage` — see `useSyncDocumentLanguage`'s doc
  // comment in `i18n/client.ts` for why the module-level assignment there
  // isn't enough on its own.
  useSyncDocumentLanguage();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Mounted once at the root so any descendant (currently just the
          notification bell's new-arrival toasts) can call `toast.add()`
          without wiring its own provider. */}
      <Toaster />
    </QueryClientProvider>
  );
}
