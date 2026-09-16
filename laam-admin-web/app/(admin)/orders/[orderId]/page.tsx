import type { Metadata } from "next";

import { OrderDetailPage } from "@/features/orders/OrderDetailPage";

export const metadata: Metadata = {
  title: "주문 상세 | LAM 관리자",
};

// `params` is a Promise in this Next.js version — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md.
export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <OrderDetailPage orderId={orderId} />;
}
