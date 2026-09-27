import type { Metadata } from "next";

import { BillDetailPage } from "@/features/orders/bills/BillDetailPage";

export const metadata: Metadata = {
  title: "계산서 상세 | LAM 관리자",
};

// `params` is a Promise in this Next.js version — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md.
export default async function Page({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  return <BillDetailPage billId={billId} />;
}
