import { cookies } from "next/headers";
import { cache } from "react";

import { PREVIEW_COOKIE_NAME, resolveCustomerTemplate, type CustomerTemplate } from "@/lib/customer-template";
import { readPreviewTemplate } from "@/lib/preview-request";
import { getAppData } from "@/services/app-service";

export type CustomerTemplateContext = { template: CustomerTemplate; isPreview: boolean };

/** 관리자 미리보기 쿠키가 있으면 그 템플릿, 없으면 관리자가 적용한 템플릿. */
export const getCustomerTemplateContext = cache(async (): Promise<CustomerTemplateContext> => {
  const cookieStore = await cookies();
  const previewTemplate = readPreviewTemplate(cookieStore.get(PREVIEW_COOKIE_NAME)?.value);
  if (previewTemplate) {
    return { template: previewTemplate, isPreview: true };
  }

  const appData = await getAppData();
  return { template: resolveCustomerTemplate(appData.store.customerTemplate), isPreview: false };
});
