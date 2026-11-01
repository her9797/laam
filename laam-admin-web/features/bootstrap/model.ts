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
  /** Customer screen template id (`classic`/`notebook`/`chalkboard`). Optional: older APIs omit it, and an unknown value must not crash the admin. */
  customerTemplate?: string;
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
  /** Effective customer description: `descriptionOverride` when set, else `posDescription`. */
  description: string;
  /** POS/Toss original description. Optional: older APIs omit it. */
  posDescription?: string;
  /** Operator's customer-screen description ("" = none). Optional: older APIs omit it. */
  descriptionOverride?: string;
  /** Operator-typed labels in display order ([] = none). Optional: older APIs omit it. */
  customLabels?: MenuItemCustomLabel[];
  price: string;
  imageUrl?: string;
  isVisible: boolean;
  images?: MenuImage[];
  options?: MenuOption[];
  /** Effective labels: `customLabels` if any, else the Toss labels. */
  labels?: MenuItemLabel[];
};

/** Label the operator typed on the item's detail page; `color` is one of green/amber/pink/blue. */
export type MenuItemCustomLabel = {
  text: string;
  color: string;
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
