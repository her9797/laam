/**
 * Mirrors `laam-api/internal/lamdata.BootstrapData` and its nested JSON
 * shapes exactly (field names/casing grounded in
 * `laam-api/internal/lamdata/models.go`), as returned by the public
 * `/api/v1/bootstrap` endpoint via this app's own `/api/bootstrap` BFF route.
 */
export type StoreInfo = {
  name: string;
  subtitle: string;
  address: string;
  songRequestCopy: string;
  requestCopy: string;
  eventCopy: string;
};

export type MenuCategory = {
  id: string;
  label: string;
  isVisible: boolean;
};

export type MenuImage = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  isPrimary: boolean;
  displayArea: string;
  focusX: number;
  focusY: number;
  sortOrder: number;
  contentUrl: string;
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

export type MenuOption = {
  id: string;
  title: string;
  required: boolean;
  minChoices: number;
  maxChoices: number;
  choices: MenuOptionChoice[];
};

export type MenuItem = {
  id: string;
  categoryId: string;
  badge?: string;
  badgeColor?: string;
  name: string;
  description: string;
  price: string;
  imageUrl?: string;
  isVisible: boolean;
  images?: MenuImage[];
  options?: MenuOption[];
  labels?: MenuItemLabel[];
};

// `text`는 토스플레이스 카탈로그 라벨 그대로이며 동기화가 관리한다. `color`는
// 운영자가 위치별로 지정하는 값으로, 동기화가 절대 건드리지 않는다
// (laam-api의 `UpdateMenuItemLabelColors` 참고).
export type MenuItemLabel = {
  text: string;
  color?: string;
};

export type NoticeItem = {
  id: string;
  text: string;
  isVisible: boolean;
};

export type AppData = {
  store: StoreInfo;
  categories: MenuCategory[];
  items: MenuItem[];
  requestGuides: NoticeItem[];
  notices: NoticeItem[];
};
