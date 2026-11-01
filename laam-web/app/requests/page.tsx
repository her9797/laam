import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RequestsScreen } from "@/components/screens/requests-screen";
import { getQrCookieName } from "@/lib/auth";
import { PREVIEW_COOKIE_NAME } from "@/lib/customer-template";
import { canViewCustomerPage } from "@/lib/preview-request";
import { getAppData } from "@/services/app-service";

export const dynamic = "force-dynamic";

type RequestsPageProps = {
  searchParams: Promise<{ type?: string }>;
};

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const cookieStore = await cookies();
  const qrSession = cookieStore.get(getQrCookieName())?.value;
  if (!canViewCustomerPage(qrSession, cookieStore.get(PREVIEW_COOKIE_NAME)?.value)) {
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
