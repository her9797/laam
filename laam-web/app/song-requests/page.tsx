import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SongRequestsScreen } from "@/components/screens/song-requests-screen";
import { getQrCookieName, isQrSessionValid } from "@/lib/auth";
import { getAppData } from "@/services/app-service";

export const dynamic = "force-dynamic";

export default async function SongRequestsPage() {
  const cookieStore = await cookies();
  const qrSession = cookieStore.get(getQrCookieName())?.value;
  if (!isQrSessionValid(qrSession)) {
    redirect("/access-required");
  }

  const appData = await getAppData();
  return <SongRequestsScreen store={appData.store} />;
}
