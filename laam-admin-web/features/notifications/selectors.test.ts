import { describe, expect, it } from "vitest";

import type { CustomerRequest } from "@/features/requests/model";

import { toNotifications } from "./selectors";

// Fixed on purpose: one pending general, one pending song request (older),
// one checked general (must be excluded — only `pending` becomes a
// notification per the confirmed requirement), one completed general.
const requestsFixture: CustomerRequest[] = [
  {
    id: "r1",
    tableNumber: "3",
    text: "물 좀 주세요",
    status: "pending",
    createdAt: "2026-09-04T10:05:00Z",
  },
  {
    id: "r2",
    tableNumber: "5",
    text: "[노래 신청] 아무 노래",
    status: "pending",
    createdAt: "2026-09-04T10:01:00Z",
  },
  {
    id: "r3",
    tableNumber: "1",
    text: "이미 확인한 요청",
    status: "checked",
    createdAt: "2026-09-04T10:06:00Z",
  },
  {
    id: "r4",
    tableNumber: "2",
    text: "이미 처리한 요청",
    status: "completed",
    createdAt: "2026-09-04T10:07:00Z",
  },
];

describe("toNotifications", () => {
  it("only includes pending requests", () => {
    const notifications = toNotifications(requestsFixture);
    expect(notifications.map((item) => item.id)).toEqual(["r1", "r2"]);
  });

  it("sorts by createdAt descending (newest first)", () => {
    const notifications = toNotifications(requestsFixture);
    expect(notifications[0].id).toBe("r1");
    expect(notifications[1].id).toBe("r2");
  });

  it("classifies general vs song using the shared dashboard/summary rule", () => {
    const notifications = toNotifications(requestsFixture);
    const byId = Object.fromEntries(notifications.map((item) => [item.id, item]));
    expect(byId.r1.kind).toBe("general");
    expect(byId.r2.kind).toBe("song");
  });

  it("strips the song-request prefix from the preview but keeps general text as-is", () => {
    const notifications = toNotifications(requestsFixture);
    const byId = Object.fromEntries(notifications.map((item) => [item.id, item]));
    expect(byId.r1.preview).toBe("물 좀 주세요");
    expect(byId.r2.preview).toBe("아무 노래");
  });

  it("carries the table number and createdAt through unchanged", () => {
    const notifications = toNotifications(requestsFixture);
    const byId = Object.fromEntries(notifications.map((item) => [item.id, item]));
    expect(byId.r1.tableNumber).toBe("3");
    expect(byId.r1.createdAt).toBe("2026-09-04T10:05:00Z");
  });

  it("returns an empty list when there is nothing pending", () => {
    expect(toNotifications([requestsFixture[2], requestsFixture[3]])).toEqual([]);
  });
});
