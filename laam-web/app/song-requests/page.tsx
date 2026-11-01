import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SongRequestsScreen } from "@/components/screens/song-requests-screen";
import { getQrCookieName } from "@/lib/auth";
import { PREVIEW_COOKIE_NAME } from "@/lib/customer-template";
import { canViewCustomerPage } from "@/lib/preview-request";
import { getAppData } from "@/services/app-service";

export const dynamic = "force-dynamic";

export default async function SongRequestsPage() {
  const cookieStore = await cookies();
  const qrSession = cookieStore.get(getQrCookieName())?.value;
  if (!canViewCustomerPage(qrSession, cookieStore.get(PREVIEW_COOKIE_NAME)?.value)) {
    redirect("/access-required");
  }

  const appData = await getAppData();
  return <SongRequestsScreen store={appData.store} />;
}
