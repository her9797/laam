import type { Metadata } from "next";

import { DashboardPage } from "@/features/dashboard/DashboardPage";

export const metadata: Metadata = {
  title: "대시보드 | LAM 관리자",
};

export default function Page() {
  return <DashboardPage />;
}
