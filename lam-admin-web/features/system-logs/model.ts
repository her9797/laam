/**
 * Mirrors `lam-api`'s admin system log entry
 * (`GET /api/v1/admin/system-logs`). This is a read-only diagnostics feed —
 * an entry is always a server-side failure (5xx), never a client request
 * error, so `status` is typed loosely as `number` rather than a closed
 * union: the exact set of upstream codes is an implementation detail this
 * screen shouldn't have to track.
 */
export type SystemLog = {
  id: string;
  method: string;
  path: string;
  status: number;
  message: string;
  createdAt: string;
};

export type SystemLogListQuery = {
  page: number;
  pageSize: number;
};

/** Mirrors `lam-api`'s system log page envelope. */
export type SystemLogPageResult = {
  items: SystemLog[];
  page: number;
  pageSize: number;
  total: number;
};
