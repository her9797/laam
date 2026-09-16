import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Maps an i18next language tag onto the BCP 47 locale `Intl` should format
 * with. Kept explicit (rather than passing `i18n.language` straight through)
 * because the detector can hand back a region-less "en"/"ko" or a regional
 * variant, and the request lists must stay on the two locales this app
 * actually ships.
 */
export function resolveDateTimeLocale(language: string | undefined): string {
  return language?.toLowerCase().startsWith("en") ? "en-US" : "ko-KR"
}

/**
 * Formats an ISO timestamp for display in request/special-request lists:
 * `MM/DD HH:mm`, 24-hour, in `language` (the Korean shape mirrors
 * `laam-web`'s `admin-screen.tsx` `formatCustomerRequestDate`, so operators
 * see what they're used to). Falls back to the raw string for an unparseable
 * value instead of throwing.
 *
 * The current language is passed in by the caller — every caller is a client
 * component that already holds it via `useTranslation()` — rather than read
 * from the i18n singleton here, so this module (imported by every `ui/`
 * primitive through `cn`) stays free of an i18next dependency and keeps
 * working in server components.
 */
export function formatDateTime(value: string, language?: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(
    resolveDateTimeLocale(language),
    {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  ).format(date)
}

/**
 * Formats a raw won amount (e.g. `payment_orders.amount`) as currency, used
 * by both `features/orders/OrderListPage.tsx` and
 * `features/orders/stats/SalesStatsPage.tsx`. `style: "currency"` renders a
 * "₩" symbol, not a translated word, so this needs no i18n resource key of
 * its own — unlike `laam-api`'s `menu_items.price`, which is a pre-formatted
 * "10,000원" string from the backend, kept as-is regardless of UI language.
 */
export function formatCurrencyKRW(amount: number, language?: string): string {
  return new Intl.NumberFormat(resolveDateTimeLocale(language), {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount)
}
