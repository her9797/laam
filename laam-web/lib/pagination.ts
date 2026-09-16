export function paginateItems<T>(items: T[], requestedPage: number, requestedPageSize: number) {
  const pageSize = Math.max(1, Math.floor(requestedPageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
  const page = Math.min(Math.max(1, normalizedPage), pageCount);
  const startIndex = (page - 1) * pageSize;

  return {
    items: items.slice(startIndex, startIndex + pageSize),
    page,
    pageCount,
    total,
  };
}
