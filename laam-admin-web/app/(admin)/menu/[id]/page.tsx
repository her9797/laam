import type { Metadata } from "next";

import { MenuItemDetailPage } from "@/features/menu/MenuItemDetailPage";

export const metadata: Metadata = {
  title: "메뉴 상세 | LAM 관리자",
};

// `params` is a Promise in this Next.js version — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MenuItemDetailPage menuItemId={id} />;
}
