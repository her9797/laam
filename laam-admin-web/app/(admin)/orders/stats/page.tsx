import type { Metadata } from "next";

import { SalesStatsPage } from "@/features/orders/stats/SalesStatsPage";

export const metadata: Metadata = {
  title: "매출 통계 | LAM 관리자",
};

export default function Page() {
  return <SalesStatsPage />;
}
