import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { HomeScreen } from "@/components/screens/home-screen";
import { getQrCookieName, getStaffCookieName, isStaffSessionValid } from "@/lib/auth";
import { getCustomerTemplateContext } from "@/lib/customer-template-context";
import { PREVIEW_COOKIE_NAME } from "@/lib/customer-template";
import { canViewCustomerPage } from "@/lib/preview-request";
import {
  getAppData,
  getFeaturedCategoryFromData,
  getFeaturedItemsFromData,
  getVisibleNoticesFromData,
} from "@/services/app-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const qrSession = cookieStore.get(getQrCookieName())?.value;
  const staffSession = cookieStore.get(getStaffCookieName())?.value;
  if (!canViewCustomerPage(qrSession, cookieStore.get(PREVIEW_COOKIE_NAME)?.value)) {
    redirect("/access-required");
  }

  const appData = await getAppData();
  const { template } = await getCustomerTemplateContext();

  return (
    <HomeScreen
      store={appData.store}
      featuredCategory={getFeaturedCategoryFromData(appData)}
      featuredItems={getFeaturedItemsFromData(appData)}
      canEditTable={isStaffSessionValid(staffSession)}
      template={template}
      notices={getVisibleNoticesFromData(appData)}
    />
  );
}
