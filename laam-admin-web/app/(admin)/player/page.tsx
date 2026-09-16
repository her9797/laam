import type { Metadata } from "next";

import { SongPlayerPage } from "@/features/player/SongPlayerPage";

export const metadata: Metadata = {
  title: "매장 음악 플레이어 | LAM 관리자",
};

export default function Page() {
  return <SongPlayerPage />;
}
