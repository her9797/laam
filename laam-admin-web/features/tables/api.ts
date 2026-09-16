import { fetchJson } from "@/lib/api/fetch-json";

import type { AdminTable } from "./model";

const TABLES_PATH = "/api/admin/tables";

type AdminTablesResponse = {
  tables: AdminTable[];
};

export async function fetchAdminTables(): Promise<AdminTable[]> {
  const response = await fetchJson<AdminTablesResponse>(TABLES_PATH, { method: "GET" });
  return response.tables;
}
