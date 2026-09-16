import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { EventsScreen } from "@/components/screens/events-screen";
import { getQrCookieName, isQrSessionValid } from "@/lib/auth";
import { getAppData, getVisibleNoticesFromData } from "@/services/app-service";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const cookieStore = await cookies();
  const qrSession = cookieStore.get(getQrCookieName())?.value;
  if (!isQrSessionValid(qrSession)) {
    redirect("/access-required");
  }

  const appData = await getAppData();
  return <EventsScreen store={appData.store} notices={getVisibleNoticesFromData(appData)} />;
}
