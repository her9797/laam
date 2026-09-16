"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value`, but only updates to a new value after it has stayed
 * unchanged for `delayMs`. Used by list search inputs so typing doesn't fire
 * a request (server-backed lists) or a full re-filter (client-side lists)
 * on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
