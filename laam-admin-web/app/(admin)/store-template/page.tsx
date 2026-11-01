import type { Metadata } from "next";

import { StoreTemplatePage } from "@/features/store-template/StoreTemplatePage";

export const metadata: Metadata = {
  title: "손님 화면 템플릿 | LAM 관리자",
};

export default function Page() {
  return <StoreTemplatePage />;
}
