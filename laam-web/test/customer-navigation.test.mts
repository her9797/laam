import assert from "node:assert/strict";
import test from "node:test";

import { customerNavigationItems } from "../lib/customer-navigation.ts";

test("고객 내비게이션은 메뉴를 포함해 모든 주요 기능으로 이동할 수 있다", () => {
  assert.deepEqual(
    customerNavigationItems.map(({ key, href, badgeLabel }) => ({ key, href, badgeLabel })),
    [
      { key: "menu", href: "/menu", badgeLabel: "메뉴" },
      { key: "song-requests", href: "/song-requests", badgeLabel: "노래신청" },
      { key: "requests", href: "/requests", badgeLabel: "일반 요청" },
      { key: "special-requests", href: "/special-requests", badgeLabel: "특별한 요청" },
      { key: "events", href: "/events", badgeLabel: "공지" },
    ],
  );
});
