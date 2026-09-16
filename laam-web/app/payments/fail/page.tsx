import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getQrCookieName, isQrSessionValid } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PaymentFailPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const cookieStore = await cookies();
  if (!isQrSessionValid(cookieStore.get(getQrCookieName())?.value)) {
    redirect("/access-required");
  }
  const { message } = await searchParams;
  return (
    <main className="page-shell payment-page">
      <section className="phone-frame payment-frame">
        <div className="content-card payment-card payment-result-card">
          <p className="section-kicker">payment result</p>
          <h1>결제가 완료되지 않았어요</h1>
          <p className="payment-result-copy">{message?.slice(0, 160) || "결제가 취소되었거나 처리 중 문제가 발생했습니다."}</p>
          <Link className="request-compose-button payment-result-link" href="/menu">메뉴로 돌아가기</Link>
        </div>
      </section>
    </main>
  );
}
