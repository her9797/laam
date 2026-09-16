import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/states/PageStates";
import { MenuManagementPage } from "@/features/menu/MenuManagementPage";

export const metadata: Metadata = {
  title: "메뉴 관리 | LAM 관리자",
};

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MenuManagementPage />
    </Suspense>
  );
}
