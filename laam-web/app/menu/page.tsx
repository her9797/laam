import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { CategoryScreen } from "@/components/screens/category-screen";
import { getQrCookieName } from "@/lib/auth";
import { getCustomerMenuCategories } from "@/lib/customer-menu-categories";
import { PREVIEW_COOKIE_NAME } from "@/lib/customer-template";
import { canViewCustomerPage } from "@/lib/preview-request";
import {
  getAppData,
  getMenuItemsByCategoryFromData,
} from "@/services/app-service";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  const cookieStore = await cookies();
  const qrSession = cookieStore.get(getQrCookieName())?.value;
  if (!canViewCustomerPage(qrSession, cookieStore.get(PREVIEW_COOKIE_NAME)?.value)) {
    redirect("/access-required");
  }

  const appData = await getAppData();
  const categories = getCustomerMenuCategories(appData.categories, appData.items);
  const category = categories[0];

  if (!category) {
    notFound();
  }

  return (
    <CategoryScreen
      store={appData.store}
      categories={categories}
      category={category}
      items={getMenuItemsByCategoryFromData(appData, category.id)}
    />
  );
}
