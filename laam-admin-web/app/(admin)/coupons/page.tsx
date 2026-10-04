import type { Metadata } from "next";

import { CouponManagementPage } from "@/features/coupons/CouponManagementPage";

export const metadata: Metadata = {
  title: "쿠폰 관리 | LAM 관리자",
};

export default function Page() {
  return <CouponManagementPage />;
}
