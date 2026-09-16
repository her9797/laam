import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/states/PageStates";
import { OrderListPage } from "@/features/orders/OrderListPage";

export const metadata: Metadata = {
  title: "주문 내역 | LAM 관리자",
};

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <OrderListPage />
    </Suspense>
  );
}
