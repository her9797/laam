import type { Metadata } from "next";

import { ItemsManagementPage } from "@/features/inventory/ItemsManagementPage";

export const metadata: Metadata = {
  title: "품목·분류 | LAM 관리자",
};

export default function Page() {
  return <ItemsManagementPage />;
}
