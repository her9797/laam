import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { isUnauthorizedError } from "@/lib/api/fetch-json";

/**
 * The single login-redirect boundary for 401 responses. Every query and
 * mutation created from the `QueryClient` this module builds funnels its
 * errors through `QueryCache`/`MutationCache` `onError`, so a 401 is
 * handled exactly once here — no feature page or hook needs its own 401
 * check, and none should add one.
 */
const ADMIN_LOGIN_PATH = "/login";

function redirectToLogin(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (window.location.pathname === ADMIN_LOGIN_PATH) {
    return;
  }
  // This fires from `QueryCache`/`MutationCache` `onError`, outside any
  // React render/component tree — there is no `useRouter()` (a hook) and
  // no server render phase (for `redirect()`) available here. A hard
  // navigation is also appropriate for this specific case: it discards any
  // stale client state for the now-invalid session along with the redirect.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(ADMIN_LOGIN_PATH);
}

function handleCacheError(error: unknown): void {
  if (isUnauthorizedError(error)) {
    redirectToLogin();
  }
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isUnauthorizedError(error)) {
    return false;
  }
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleCacheError }),
    mutationCache: new MutationCache({ onError: handleCacheError }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
