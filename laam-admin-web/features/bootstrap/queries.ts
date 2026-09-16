import { useQuery } from "@tanstack/react-query";

import { fetchBootstrap } from "./api";

/**
 * `bootstrapKeys.all` is the single cache key for the whole `AppData` tree
 * (store copy, categories, menu items, notices, request guides). Any
 * mutation that changes menu/category/notice/store-copy data (Task 6/7's
 * `features/menu` and `features/notices` api modules) invalidates only
 * this key — never `requestsKeys.all` or `specialRequestKeys.all`.
 */
export const bootstrapKeys = {
  all: ["bootstrap"] as const,
};

export function useBootstrapQuery() {
  return useQuery({
    queryKey: bootstrapKeys.all,
    queryFn: fetchBootstrap,
  });
}
