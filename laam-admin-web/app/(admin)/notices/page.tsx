import type { Metadata } from "next";

import { NoticeManagementPage } from "@/features/notices/NoticeManagementPage";

export const metadata: Metadata = {
  title: "이벤트·공지 | LAM 관리자",
};

export default function Page() {
  return <NoticeManagementPage />;
}
