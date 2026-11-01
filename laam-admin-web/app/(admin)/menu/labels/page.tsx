import type { Metadata } from "next";

import { MenuLabelManagementPage } from "@/features/menu/MenuLabelManagementPage";

export const metadata: Metadata = {
  title: "라벨 관리 | LAM 관리자",
};

export default function Page() {
  return <MenuLabelManagementPage />;
}
