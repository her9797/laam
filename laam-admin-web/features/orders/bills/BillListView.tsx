import type { BillListQuery } from "./model";

export type BillListViewProps = {
  query: BillListQuery;
  /** False while the parent's date range is still unresolved (see `OrderListPage`). */
  enabled: boolean;
  onPageChange: (page: number) => void;
};

/**
 * Bill-grouped (계산서별) order history. Placeholder contract for the
 * 주문내역 view toggle; the list itself is implemented separately.
 */
export function BillListView(_props: BillListViewProps) {
  return null;
}
