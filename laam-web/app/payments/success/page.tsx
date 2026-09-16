import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PaymentSuccessScreen } from "@/components/payments/payment-success-screen";
import { getQrCookieName, isQrSessionValid } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string }>;
}) {
  const cookieStore = await cookies();
  if (!isQrSessionValid(cookieStore.get(getQrCookieName())?.value)) {
    redirect("/access-required");
  }
  const params = await searchParams;
  const amount = Number(params.amount);
  if (!params.paymentKey || !params.orderId || !Number.isSafeInteger(amount) || amount <= 0) {
    redirect("/payments/fail?message=결제+정보가+올바르지+않습니다.");
  }
  return <PaymentSuccessScreen paymentKey={params.paymentKey} orderId={params.orderId} amount={amount} />;
}
