export type MenuCategory = {
  id: string;
  label: string;
  isVisible?: boolean;
};

export type MenuItem = {
  id: string;
  categoryId: string;
  badge?: string;
  badgeColor?: "green" | "amber" | "pink" | "blue";
  name: string;
  description: string;
  price: string;
  imageUrl?: string;
  isVisible?: boolean;
  images?: MenuImage[];
  options?: MenuOption[];
  labels?: MenuItemLabel[];
};

export type MenuItemLabel = {
  text: string;
  color?: string;
};

export type MenuOption = {
  id: string;
  title: string;
  required: boolean;
  minChoices: number;
  maxChoices: number;
  choices: MenuOptionChoice[];
};

export type MenuOptionChoice = {
  id: string;
  title: string;
  priceValue: number;
  imageUrl?: string;
  quantityEnabled: boolean;
  minQuantity: number;
  maxQuantity: number;
};

export type MenuImage = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  isPrimary: boolean;
  displayArea: "home" | "menu" | "both";
  focusX: number;
  focusY: number;
  sortOrder: number;
  contentUrl: string;
};

export type NoticeItem = {
  id: string;
  text: string;
  isVisible?: boolean;
};

export type StoreInfo = {
  name: string;
  subtitle: string;
  address: string;
  songRequestCopy: string;
  requestCopy: string;
  eventCopy: string;
};

export const store: StoreInfo = {
  name: "laam",
  subtitle: "혼술 바를 위한 QR 메뉴 초안",
  address: "서울 마포구 망원동 57-23",
  songRequestCopy: "듣고 싶은 곡을 남겨주세요.",
  requestCopy: "전하고 싶은 요청이나 하고 싶은 말을 남겨주세요.",
  eventCopy: "공지와 운영 이벤트를 모아봤습니다.",
};

export const categories: MenuCategory[] = [
  { id: "signature", label: "대표" },
  { id: "food", label: "안주" },
  { id: "highball", label: "하이볼" },
  { id: "whisky", label: "위스키" },
  { id: "wine", label: "와인" },
];

export const menuItems: MenuItem[] = [
  {
    id: "steak",
    categoryId: "signature",
    badge: "signature",
    name: "laam 시그니처 스테이크",
    description: "짙은 풍미의 스테이크와 구운 채소",
    price: "29,000원",
  },
  {
    id: "truffle-fries",
    categoryId: "signature",
    badge: "best",
    name: "트러플 프라이",
    description: "가볍게 시작하기 좋은 인기 메뉴",
    price: "11,000원",
  },
  {
    id: "beef-tartare",
    categoryId: "signature",
    badge: "chef",
    name: "비프 타르타르",
    description: "고소한 노른자와 허브 오일을 곁들인 시그니처 플레이트",
    price: "19,000원",
  },
  {
    id: "octopus-carpaccio",
    categoryId: "signature",
    name: "문어 카르파초",
    description: "산뜻한 시트러스 드레싱과 후추의 밸런스",
    price: "21,000원",
  },
  {
    id: "cheese-platter",
    categoryId: "food",
    badge: "share",
    name: "치즈 플래터",
    description: "와인과 잘 어울리는 치즈와 견과",
    price: "18,000원",
  },
  {
    id: "smoked-sausage",
    categoryId: "food",
    name: "훈제 소시지 플레이트",
    description: "바삭한 감자와 머스터드 소스",
    price: "16,000원",
  },
  {
    id: "butter-squid",
    categoryId: "food",
    badge: "popular",
    name: "버터 먹태구이",
    description: "부드럽게 찢어 먹기 좋은 시그니처 건어물 안주",
    price: "17,000원",
  },
  {
    id: "spicy-pasta",
    categoryId: "food",
    name: "매콤 로제 파스타",
    description: "늦은 밤에도 부담 없이 즐기기 좋은 한 접시",
    price: "18,500원",
  },
  {
    id: "truffle-potato",
    categoryId: "food",
    name: "트러플 감자전",
    description: "겉은 바삭하고 속은 촉촉한 감자전 스타일 안주",
    price: "15,500원",
  },
  {
    id: "burrata-salad",
    categoryId: "food",
    badge: "fresh",
    name: "부라타 토마토 샐러드",
    description: "상큼한 토마토와 바질 페스토 조합",
    price: "16,000원",
  },
  {
    id: "house-highball",
    categoryId: "highball",
    badge: "today",
    name: "하우스 하이볼",
    description: "레몬 향을 더한 드라이한 밸런스",
    price: "9,000원",
  },
  {
    id: "yuzu-highball",
    categoryId: "highball",
    name: "유자 하이볼",
    description: "상큼한 향과 부드러운 탄산감",
    price: "10,000원",
  },
  {
    id: "earlgrey-highball",
    categoryId: "highball",
    name: "얼그레이 하이볼",
    description: "은은한 티 향이 길게 남는 시그니처 하이볼",
    price: "11,000원",
  },
  {
    id: "ginger-highball",
    categoryId: "highball",
    badge: "dry",
    name: "진저 하이볼",
    description: "진저 스파이스가 선명한 드라이 타입",
    price: "10,500원",
  },
  {
    id: "green-grape-highball",
    categoryId: "highball",
    name: "청포도 하이볼",
    description: "달지 않고 깔끔하게 떨어지는 프루티 스타일",
    price: "10,500원",
  },
  {
    id: "smoky-highball",
    categoryId: "highball",
    badge: "limited",
    name: "스모키 하이볼",
    description: "피트 향을 가볍게 살린 한정 레시피",
    price: "12,000원",
  },
  {
    id: "apple-highball",
    categoryId: "highball",
    name: "애플 하이볼",
    description: "은은한 사과 향과 산뜻한 탄산감",
    price: "10,500원",
  },
  {
    id: "grapefruit-highball",
    categoryId: "highball",
    badge: "citrus",
    name: "자몽 하이볼",
    description: "쌉쌀한 자몽 향이 또렷한 시트러스 스타일",
    price: "10,500원",
  },
  {
    id: "melon-highball",
    categoryId: "highball",
    name: "멜론 하이볼",
    description: "부드럽고 달콤한 향이 가볍게 도는 타입",
    price: "11,000원",
  },
  {
    id: "plum-highball",
    categoryId: "highball",
    badge: "house",
    name: "매실 하이볼",
    description: "새콤한 매실 향으로 마무리가 깔끔한 하우스 레시피",
    price: "10,000원",
  },
  {
    id: "basil-lemon-highball",
    categoryId: "highball",
    name: "바질 레몬 하이볼",
    description: "허브 향과 레몬의 산뜻함이 살아 있는 스타일",
    price: "11,500원",
  },
  {
    id: "pear-highball",
    categoryId: "highball",
    name: "배 하이볼",
    description: "부드럽고 은은한 배 향이 길게 남는 타입",
    price: "10,500원",
  },
  {
    id: "cola-highball",
    categoryId: "highball",
    badge: "classic",
    name: "콜라 하이볼",
    description: "가볍고 편하게 마시기 좋은 클래식 변주",
    price: "9,500원",
  },
  {
    id: "coffee-highball",
    categoryId: "highball",
    badge: "late-night",
    name: "콜드브루 하이볼",
    description: "씁쓸한 커피 향과 위스키의 균형감이 또렷한 한 잔",
    price: "12,000원",
  },
  {
    id: "tonic-highball",
    categoryId: "highball",
    name: "토닉 하이볼",
    description: "청량하고 드라이한 느낌을 선호할 때 추천",
    price: "10,000원",
  },
  {
    id: "seasonal-highball",
    categoryId: "highball",
    badge: "seasonal",
    name: "시즌 하이볼",
    description: "제철 과일이나 허브를 활용한 한정 레시피",
    price: "12,500원",
  },
  {
    id: "glass-whisky",
    categoryId: "whisky",
    badge: "glass",
    name: "싱글몰트 위스키 1잔",
    description: "오늘의 추천 라인업 중 선택",
    price: "15,000원~",
  },
  {
    id: "bourbon-flight",
    categoryId: "whisky",
    badge: "flight",
    name: "버번 테이스팅 플라이트",
    description: "세 가지 버번을 가볍게 비교해보는 구성",
    price: "27,000원",
  },
  {
    id: "peat-whisky",
    categoryId: "whisky",
    name: "피트 위스키 글라스",
    description: "짙은 스모키 향을 좋아하는 손님 추천",
    price: "18,000원~",
  },
  {
    id: "japanese-whisky",
    categoryId: "whisky",
    name: "재패니즈 위스키 글라스",
    description: "부드럽고 균형감 있는 스타일 위주로 구성",
    price: "17,000원~",
  },
  {
    id: "old-fashioned",
    categoryId: "whisky",
    badge: "classic",
    name: "올드 패션드",
    description: "오렌지 필과 비터스가 살아 있는 클래식",
    price: "16,000원",
  },
  {
    id: "house-wine",
    categoryId: "wine",
    badge: "glass",
    name: "하우스 와인",
    description: "레드 또는 화이트 글라스 선택",
    price: "8,000원",
  },
  {
    id: "sparkling-wine",
    categoryId: "wine",
    badge: "sparkling",
    name: "스파클링 와인",
    description: "가볍게 시작하기 좋은 산뜻한 버블",
    price: "11,000원",
  },
  {
    id: "orange-wine",
    categoryId: "wine",
    name: "오렌지 와인",
    description: "향이 풍부하고 개성 있는 한 잔",
    price: "12,000원",
  },
  {
    id: "red-bottle",
    categoryId: "wine",
    name: "레드 와인 보틀",
    description: "직원 추천 리스트 중 선택 가능",
    price: "39,000원~",
  },
  {
    id: "white-bottle",
    categoryId: "wine",
    name: "화이트 와인 보틀",
    description: "산뜻한 타입부터 묵직한 타입까지 준비",
    price: "37,000원~",
  },
  {
    id: "white-bottle-2",
    categoryId: "wine",
    name: "화이트 와인 보틀",
    description: "산뜻한 타입부터 묵직한 타입까지 준비",
    price: "37,000원~",
  },
  {
    id: "white-bottle-3",
    categoryId: "wine",
    name: "화이트 와인 보틀",
    description: "산뜻한 타입부터 묵직한 타입까지 준비",
    price: "37,000원~",
  },
];

export const requestGuides: NoticeItem[] = [
  {
    id: "allergy",
    text: "알레르기 유발 재료가 있으면 주문 전 꼭 말씀해주세요.",
  },
  {
    id: "soldout",
    text: "일부 주류와 안주는 당일 재고에 따라 조기 품절될 수 있습니다.",
  },
  {
    id: "seat-time",
    text: "혼술 손님 위주 운영 특성상 좌석 이동이 필요할 수 있습니다.",
  },
  {
    id: "pairing",
    text: "주류 추천이 필요하면 취향에 맞춰 페어링을 도와드립니다.",
  },
];

export const notices: NoticeItem[] = [
  { id: "hours", text: "평일 18:00 - 02:00 / 금토 18:00 - 03:00" },
  {
    id: "seat",
    text: "혼술 손님이 편하게 머물 수 있도록 좌석 간격을 넉넉히 운영합니다.",
  },
  { id: "event-1", text: "매주 화요일 하이볼 추천 메뉴 1,000원 할인" },
  {
    id: "event-2",
    text: "비 오는 날에는 스모키 하이볼 한정 레시피가 추가됩니다.",
  },
];
