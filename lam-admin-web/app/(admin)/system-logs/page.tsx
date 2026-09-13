import type { Metadata } from "next";

import { SystemLogPage } from "@/features/system-logs/SystemLogPage";

export const metadata: Metadata = {
  title: "시스템 로그 | LAM 관리자",
};

export default function Page() {
  return <SystemLogPage />;
}
