import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/states/PageStates";
import { RequestListPage } from "@/features/requests/RequestListPage";

export const metadata: Metadata = {
  title: "손님 요청 | LAM 관리자",
};

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RequestListPage kind="general" />
    </Suspense>
  );
}
