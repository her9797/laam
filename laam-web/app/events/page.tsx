import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { EventsScreen } from "@/components/screens/events-screen";
import { getQrCookieName } from "@/lib/auth";
import { PREVIEW_COOKIE_NAME } from "@/lib/customer-template";
import { canViewCustomerPage } from "@/lib/preview-request";
import { getAppData, getVisibleNoticesFromData } from "@/services/app-service";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const cookieStore = await cookies();
  const qrSession = cookieStore.get(getQrCookieName())?.value;
  if (!canViewCustomerPage(qrSession, cookieStore.get(PREVIEW_COOKIE_NAME)?.value)) {
    redirect("/access-required");
  }

  const appData = await getAppData();
  return <EventsScreen store={appData.store} notices={getVisibleNoticesFromData(appData)} />;
}
