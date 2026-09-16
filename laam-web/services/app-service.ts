import {
  categories as fallbackCategories,
  type MenuImage,
  menuItems as fallbackMenuItems,
  notices as fallbackNotices,
  requestGuides as fallbackRequestGuides,
  store as fallbackStore,
  type MenuCategory,
  type MenuItem,
  type NoticeItem,
  type StoreInfo,
} from "@/data/menu-data";

export type AppData = {
  store: StoreInfo;
  categories: MenuCategory[];
  items: MenuItem[];
  requestGuides: NoticeItem[];
  notices: NoticeItem[];
};

const API_BASE_URL = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:9090";

function normalizeImageUrl(pathOrUrl: string) {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }

  return `${API_BASE_URL}${pathOrUrl}`;
}

function normalizeMenuImages(images: MenuImage[] | undefined) {
  if (!images?.length) {
    return images;
  }

  return images.map((image) => ({
    ...image,
    contentUrl: normalizeImageUrl(image.contentUrl),
  }));
}

function normalizeStoreInfo(store: StoreInfo): StoreInfo {
  return {
    ...store,
    address: store.address === "서울 강남구" ? "서울 마포구 망원동 57-23" : store.address,
    songRequestCopy: store.songRequestCopy || "듣고 싶은 곡을 남겨주세요.",
    requestCopy: store.requestCopy || "전하고 싶은 요청이나 하고 싶은 말을 남겨주세요.",
    eventCopy: store.eventCopy || "공지와 운영 이벤트를 모아봤습니다.",
  };
}

function getFallbackAppData(): AppData {
  return {
    store: fallbackStore,
    categories: fallbackCategories,
    items: fallbackMenuItems,
    requestGuides: fallbackRequestGuides,
    notices: fallbackNotices,
  };
}

function isAppData(payload: unknown): payload is AppData {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<AppData>;
  return (
    !!candidate.store &&
    typeof candidate.store.name === "string" &&
    Array.isArray(candidate.categories) &&
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.requestGuides) &&
    Array.isArray(candidate.notices)
  );
}

export async function getAppData(): Promise<AppData> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/bootstrap`, {
      cache: "no-store",
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(1500),
    });

    if (!response.ok) {
      throw new Error(`bootstrap api request failed: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!isAppData(payload)) {
      throw new Error("bootstrap api returned an invalid payload");
    }

    return normalizeAppDataImages(payload);
  } catch (error) {
    console.warn("Falling back to local app data.", error);
    return getFallbackAppData();
  }
}

export function normalizeAppDataImages(appData: AppData): AppData {
  return {
    ...appData,
    store: normalizeStoreInfo(appData.store),
    items: appData.items.map((item) => ({
      ...item,
      imageUrl: item.imageUrl ? normalizeImageUrl(item.imageUrl) : item.imageUrl,
      images: normalizeMenuImages(item.images),
    })),
  };
}

export function getFeaturedCategoryFromData(appData: AppData) {
  const visibleCategories = appData.categories.filter((category) => category.isVisible !== false);
  return visibleCategories.find((category) => category.id === "signature") ?? visibleCategories[0];
}

export function getCategoryByIdFromData(appData: AppData, categoryId: string) {
  return appData.categories.find((category) => category.id === categoryId && category.isVisible !== false);
}

export function getMenuItemsByCategoryFromData(appData: AppData, categoryId: string) {
  return appData.items.filter((item) => item.categoryId === categoryId && item.isVisible !== false);
}

export function getFeaturedItemsFromData(appData: AppData) {
  const featuredCategory = getFeaturedCategoryFromData(appData);
  return featuredCategory ? getMenuItemsByCategoryFromData(appData, featuredCategory.id).slice(0, 3) : [];
}

export function getVisibleCategoriesFromData(appData: AppData) {
  return appData.categories.filter((category) => category.isVisible !== false);
}

export function getVisibleRequestGuidesFromData(appData: AppData) {
  return appData.requestGuides.filter((item) => item.isVisible !== false);
}

export function getVisibleNoticesFromData(appData: AppData) {
  return appData.notices.filter((item) => item.isVisible !== false);
}
