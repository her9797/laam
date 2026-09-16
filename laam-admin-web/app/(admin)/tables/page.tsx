import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/states/PageStates";
import { TableQrPage } from "@/features/tables/TableQrPage";

export const metadata: Metadata = {
  title: "테이블 QR 관리 | LAM 관리자",
};

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <TableQrPage />
    </Suspense>
  );
}
