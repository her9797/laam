import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CheckoutScreen } from "@/components/payments/checkout-screen";
import { getQrCookieName, isQrSessionValid } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const cookieStore = await cookies();
  if (!isQrSessionValid(cookieStore.get(getQrCookieName())?.value)) {
    redirect("/access-required");
  }
  const { orderId } = await searchParams;
  if (!orderId) {
    redirect("/menu");
  }

  return <CheckoutScreen orderId={orderId} clientKey={process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? ""} />;
}
