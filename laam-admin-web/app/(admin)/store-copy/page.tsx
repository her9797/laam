import type { Metadata } from "next";

import { StoreCopyPage } from "@/features/store-copy/StoreCopyPage";

export const metadata: Metadata = {
  title: "안내 문구 | LAM 관리자",
};

export default function Page() {
  return <StoreCopyPage />;
}
