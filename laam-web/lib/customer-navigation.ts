export const customerNavigationItems = [
  {
    href: "/menu",
    label: "메뉴",
    badgeLabel: "메뉴",
    key: "menu",
    description: "카테고리별 메뉴와 가격을 확인하세요.",
  },
  {
    href: "/song-requests",
    label: "노래신청",
    badgeLabel: "노래신청",
    key: "song-requests",
    description: "듣고 싶은 곡을 남겨주세요.",
  },
  {
    href: "/requests",
    label: "사장님께 한마디",
    badgeLabel: "일반 요청",
    key: "requests",
    description: "편하게 전하고 싶은 말을 남겨주세요.",
  },
  {
    href: "/special-requests",
    label: "특별한 요청",
    badgeLabel: "특별한 요청",
    key: "special-requests",
    description: "신청하면 특별한 일이 생길지도..?",
  },
  {
    href: "/events",
    label: "공지 및 이벤트",
    badgeLabel: "공지",
    key: "events",
    description: "오늘의 소식과 이벤트를 확인하세요.",
  },
] as const;

export type CustomerNavigationKey = (typeof customerNavigationItems)[number]["key"];
