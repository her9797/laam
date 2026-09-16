import { describe, expect, it } from "vitest";

import type { AppData } from "@/features/bootstrap/model";
import type { CustomerRequest } from "@/features/requests/model";

import {
  buildDashboardSummary,
  isSongRequest,
  selectGeneralRequests,
  selectSongRequests,
  stripSongRequestPrefix,
} from "./summary";

const appDataFixture: AppData = {
  store: {
    name: "LAM",
    subtitle: "",
    address: "",
    songRequestCopy: "",
    requestCopy: "",
    eventCopy: "",
  },
  categories: [{ id: "c1", label: "칵테일", isVisible: true }],
  items: [
    { id: "m1", categoryId: "c1", name: "모히토", description: "", price: "10000", isVisible: true },
    { id: "m2", categoryId: "c1", name: "진토닉", description: "", price: "11000", isVisible: true },
  ],
  requestGuides: [],
  notices: [{ id: "n1", text: "이번 주 이벤트 안내", isVisible: true }],
};

// One pending + one completed general request, one pending + one checked
// song request — fixed on purpose so the expected counts below are the
// only correct answer, not a coincidence of a larger/looser fixture.
const requestsFixture: CustomerRequest[] = [
  {
    id: "r1",
    tableNumber: "1",
    text: "물 좀 주세요",
    status: "pending",
    createdAt: "2026-09-03T10:00:00Z",
  },
  {
    id: "r2",
    tableNumber: "4",
    text: "냅킨 주세요",
    status: "completed",
    createdAt: "2026-09-03T09:00:00Z",
    handledAt: "2026-09-03T09:10:00Z",
  },
  {
    id: "r3",
    tableNumber: "2",
    text: "[노래 신청] Dynamite - BTS",
    status: "pending",
    createdAt: "2026-09-03T10:05:00Z",
  },
  {
    id: "r4",
    tableNumber: "3",
    text: "[노래 신청] Butter",
    status: "checked",
    createdAt: "2026-09-03T10:10:00Z",
  },
];

describe("isSongRequest", () => {
  it("is true only when text starts with the exact [노래 신청] prefix", () => {
    expect(isSongRequest({ text: "[노래 신청] Dynamite" })).toBe(true);
    expect(isSongRequest({ text: "물 좀 주세요" })).toBe(false);
  });

  it("does not match the prefix appearing mid-string", () => {
    expect(isSongRequest({ text: "요청: [노래 신청] Dynamite" })).toBe(false);
  });
});

describe("selectSongRequests / selectGeneralRequests", () => {
  it("splits the single customer_requests list into song vs general with no overlap and no drop", () => {
    const song = selectSongRequests(requestsFixture);
    const general = selectGeneralRequests(requestsFixture);

    expect(song.map((request) => request.id)).toEqual(["r3", "r4"]);
    expect(general.map((request) => request.id)).toEqual(["r1", "r2"]);
    expect(song.length + general.length).toBe(requestsFixture.length);
  });
});

describe("stripSongRequestPrefix", () => {
  it("removes the classification prefix for display", () => {
    expect(stripSongRequestPrefix("[노래 신청] Dynamite - BTS")).toBe("Dynamite - BTS");
  });

  it("leaves non-song text unchanged", () => {
    expect(stripSongRequestPrefix("물 좀 주세요")).toBe("물 좀 주세요");
  });
});

describe("buildDashboardSummary", () => {
  it("aggregates pending general, pending song, special request, order, menu and notice counts", () => {
    const summary = buildDashboardSummary(appDataFixture, requestsFixture, 1, 7);

    expect(summary).toEqual({
      pendingGeneralRequestCount: 1, // r1 only — r2 is completed
      pendingSongRequestCount: 1, // r3 only — r4 is checked
      specialRequestCount: 1,
      orderCount: 7,
      menuItemCount: 2,
      noticeCount: 1,
    });
  });

  it("returns all-zero counts for empty fixtures instead of throwing", () => {
    const emptyAppData: AppData = {
      ...appDataFixture,
      items: [],
      notices: [],
    };

    const summary = buildDashboardSummary(emptyAppData, [], 0, 0);

    expect(summary).toEqual({
      pendingGeneralRequestCount: 0,
      pendingSongRequestCount: 0,
      specialRequestCount: 0,
      orderCount: 0,
      menuItemCount: 0,
      noticeCount: 0,
    });
  });
});
