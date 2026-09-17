import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/states/PageStates";
import { ExpensesPage } from "@/features/expenses/ExpensesPage";

export const metadata: Metadata = {
  title: "지출 | LAM 관리자",
};

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ExpensesPage />
    </Suspense>
  );
}
