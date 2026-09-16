import { fetchJson } from "@/lib/api/fetch-json";

import type { SystemLogListQuery, SystemLogPageResult } from "./model";

const SYSTEM_LOGS_PATH = "/api/admin/system-logs";

/** Fetches a page of the admin system log feed via the admin BFF. */
export function fetchSystemLogsPage(query: SystemLogListQuery): Promise<SystemLogPageResult> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });

  return fetchJson<SystemLogPageResult>(`${SYSTEM_LOGS_PATH}?${params.toString()}`, {
    method: "GET",
  });
}
