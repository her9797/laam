/** Display helpers shared by the inventory screens. */

export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language).format(value);
}

export function formatSignedDelta(delta: number, language: string): string {
  const formatted = formatNumber(Math.abs(delta), language);
  return delta > 0 ? `+${formatted}` : delta < 0 ? `-${formatted}` : formatted;
}

// The store operates in Korea, so history timestamps read in store time
// whatever the operator's device timezone is.
export function formatDateTime(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}
