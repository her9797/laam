import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { CategoryScreen } from "@/components/screens/category-screen";
import { getQrCookieName, isQrSessionValid } from "@/lib/auth";
import { getCustomerMenuCategories } from "@/lib/customer-menu-categories";
import {
  getAppData,
  getMenuItemsByCategoryFromData,
} from "@/services/app-service";

export const dynamic = "force-dynamic";

type CategoryPageProps = {
  params: Promise<{
    category: string;
  }>;
};

export default async function CategoryPage({ params }: CategoryPageProps) {
  const cookieStore = await cookies();
  const qrSession = cookieStore.get(getQrCookieName())?.value;
  if (!isQrSessionValid(qrSession)) {
    redirect("/access-required");
  }

  const { category } = await params;
  const appData = await getAppData();
  const categories = getCustomerMenuCategories(appData.categories);
  const selectedCategory = categories.find((candidate) => candidate.id === category);

  if (!selectedCategory) {
    notFound();
  }

  return (
    <CategoryScreen
      store={appData.store}
      categories={categories}
      category={selectedCategory}
      items={getMenuItemsByCategoryFromData(appData, selectedCategory.id)}
    />
  );
}
