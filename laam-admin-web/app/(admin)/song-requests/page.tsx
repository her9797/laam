import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/states/PageStates";
import { RequestListPage } from "@/features/requests/RequestListPage";

export const metadata: Metadata = {
  title: "노래 신청 | LAM 관리자",
};

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RequestListPage kind="song" />
    </Suspense>
  );
}
