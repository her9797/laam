import type { Metadata } from "next";

import { SpecialRequestPage } from "@/features/special-requests/SpecialRequestPage";

export const metadata: Metadata = {
  title: "특별 요청 | LAM 관리자",
};

export default function Page() {
  return <SpecialRequestPage />;
}
