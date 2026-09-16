import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RequestsScreen } from "@/components/screens/requests-screen";
import { getQrCookieName, isQrSessionValid } from "@/lib/auth";
import { getAppData } from "@/services/app-service";

export const dynamic = "force-dynamic";

type RequestsPageProps = {
  searchParams: Promise<{ type?: string }>;
};

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const cookieStore = await cookies();
  const qrSession = cookieStore.get(getQrCookieName())?.value;
  if (!isQrSessionValid(qrSession)) {
    redirect("/access-required");
  }

  const appData = await getAppData();
  const { type } = await searchParams;
  return (
    <RequestsScreen
      store={appData.store}
      initialCategory={type === "special" ? "special" : "direct"}
    />
  );
}
