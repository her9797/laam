import { useQuery } from "@tanstack/react-query";

import { fetchAdminTables } from "./api";

/** Single cache entry — the table layout is fixed, no filters/pagination. */
export const tablesKeys = {
  all: ["tables"] as const,
};

export function useAdminTablesQuery() {
  return useQuery({
    queryKey: tablesKeys.all,
    queryFn: fetchAdminTables,
  });
}
