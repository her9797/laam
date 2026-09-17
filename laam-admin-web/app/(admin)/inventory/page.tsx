import type { Metadata } from "next";

import { InventoryPage } from "@/features/inventory/InventoryPage";

export const metadata: Metadata = {
  title: "재고 | LAM 관리자",
};

export default function Page() {
  return <InventoryPage />;
}
