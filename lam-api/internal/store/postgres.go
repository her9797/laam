package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/her9797/lam/lam-api/internal/lamdata"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidInput  = errors.New("invalid input")
	ErrAlreadyExists = errors.New("resource already exists")
	ErrNotFound      = errors.New("resource not found")
)

// idSeq backstops nextID's timestamp against two calls landing in the same
// nanosecond (observed in CI: two Create* calls close enough together to
// share a UnixMilli() value collided on the same id and the second insert
// failed with ErrAlreadyExists).
var idSeq int64

func nextID(prefix string) string {
	return fmt.Sprintf("%s-%d-%d", prefix, time.Now().UnixNano(), atomic.AddInt64(&idSeq, 1))
}

type CreateMenuItemInput struct {
	CategoryID  string
	Badge       string
	BadgeColor  string
	Name        string
	Description string
	Price       string
	IsVisible   bool
}

type CreateMenuImageInput struct {
	MenuItemID  string
	Filename    string
	MimeType    string
	Content     []byte
	IsPrimary   bool
	DisplayArea string
	FocusX      int
	FocusY      int
}

type QueueSongRequestInput struct {
	YouTubeVideoID      string
	YouTubeTitle        string
	YouTubeChannelTitle string
}

type MenuImageContent struct {
	Filename string
	MimeType string
	Content  []byte
}

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) EnsureSchema(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `
CREATE TABLE IF NOT EXISTS store_profile (
  id SMALLINT PRIMARY KEY,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  address TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  toss_catalog_item_id TEXT,
  category_id TEXT NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  badge TEXT,
  badge_color TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_item_images (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content BYTEA NOT NULL,
  size_bytes BIGINT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  display_area TEXT NOT NULL DEFAULT 'menu',
  focus_x INTEGER NOT NULL DEFAULT 50,
  focus_y INTEGER NOT NULL DEFAULT 50,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_options (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  min_choices INTEGER NOT NULL DEFAULT 0,
  max_choices INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_option_choices (
  id TEXT PRIMARY KEY,
  option_id TEXT NOT NULL REFERENCES menu_options(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  price_value BIGINT NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  state TEXT NOT NULL DEFAULT 'ON_SALE',
  quantity_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  min_quantity BIGINT NOT NULL DEFAULT 1,
  max_quantity BIGINT NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_item_options (
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES menu_options(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_item_id, option_id)
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE SET NULL,
  toss_catalog_item_id TEXT,
  menu_item_name TEXT NOT NULL,
  category_name TEXT NOT NULL,
  table_number TEXT NOT NULL DEFAULT '',
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'READY',
  payment_key TEXT UNIQUE,
  payment_method TEXT,
  approved_at TIMESTAMPTZ,
  vat BIGINT NOT NULL DEFAULT 0,
  supplied_amount BIGINT NOT NULL DEFAULT 0,
  tax_free_amount BIGINT NOT NULL DEFAULT 0,
  pos_sync_status TEXT NOT NULL DEFAULT 'PENDING',
  pos_order_id TEXT,
  pos_sync_error TEXT,
  pos_claim_ready BOOLEAN NOT NULL DEFAULT FALSE,
  pos_claim_token TEXT,
  pos_claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_order_option_choices (
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  option_choice_id TEXT NOT NULL,
  option_title TEXT NOT NULL,
  option_choice_title TEXT NOT NULL,
  price_value BIGINT NOT NULL,
  quantity BIGINT NOT NULL,
  PRIMARY KEY (order_id, option_choice_id)
);

CREATE TABLE IF NOT EXISTS request_guides (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_requests (
  id TEXT PRIMARY KEY,
  table_number TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS song_playback_queue (
  id TEXT PRIMARY KEY,
  customer_request_id TEXT NOT NULL UNIQUE REFERENCES customer_requests(id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  youtube_title TEXT NOT NULL,
  youtube_channel_title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'playing', 'completed')),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS special_requests (
  id TEXT PRIMARY KEY,
  table_number TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL,
  name TEXT NOT NULL,
  age TEXT NOT NULL,
  residence TEXT NOT NULL,
  instagram TEXT NOT NULL,
  ideal_type TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS badge_color TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS toss_catalog_item_id TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS toss_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE request_guides ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE menu_item_images ADD COLUMN IF NOT EXISTS display_area TEXT NOT NULL DEFAULT 'menu';
ALTER TABLE menu_item_images ADD COLUMN IF NOT EXISTS focus_x INTEGER NOT NULL DEFAULT 50;
ALTER TABLE menu_item_images ADD COLUMN IF NOT EXISTS focus_y INTEGER NOT NULL DEFAULT 50;
ALTER TABLE customer_requests ADD COLUMN IF NOT EXISTS table_number TEXT NOT NULL DEFAULT '';
ALTER TABLE special_requests ADD COLUMN IF NOT EXISTS table_number TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS vat BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS supplied_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS tax_free_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS toss_catalog_item_id TEXT;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS request_note TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS pos_claim_ready BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS pos_claim_token TEXT;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS pos_claimed_at TIMESTAMPTZ;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS recipe_ingredients TEXT NOT NULL DEFAULT '';
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS recipe_instructions TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_customer_requests_created_at ON customer_requests (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_customer_requests_status ON customer_requests (status);
CREATE INDEX IF NOT EXISTS idx_song_playback_queue_active ON song_playback_queue (status, queued_at, id);
CREATE INDEX IF NOT EXISTS idx_special_requests_created_at ON special_requests (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders (status, pos_sync_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_toss_catalog_item_id ON menu_items (toss_catalog_item_id) WHERE toss_catalog_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_menu_item_options_menu_item_id ON menu_item_options (menu_item_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_menu_option_choices_option_id ON menu_option_choices (option_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_payment_order_option_choices_order_id ON payment_order_option_choices (order_id);
ALTER TABLE store_profile ADD COLUMN IF NOT EXISTS song_request_copy TEXT NOT NULL DEFAULT '';
ALTER TABLE store_profile ADD COLUMN IF NOT EXISTS request_copy TEXT NOT NULL DEFAULT '';
ALTER TABLE store_profile ADD COLUMN IF NOT EXISTS event_copy TEXT NOT NULL DEFAULT '';
UPDATE store_profile SET name = 'laam' WHERE id = 1 AND name = 'lam';
UPDATE store_profile
SET address = '서울 마포구 망원동 57-23'
WHERE id = 1 AND address = '서울 강남구';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'customer_requests'
      AND column_name = 'category'
  ) THEN
    INSERT INTO special_requests (id, gender, name, age, residence, instagram, ideal_type, text, created_at)
    SELECT
      id,
      COALESCE(gender, ''),
      COALESCE(name, ''),
      COALESCE(age, ''),
      COALESCE(residence, ''),
      COALESCE(instagram, ''),
      COALESCE(ideal_type, ''),
      text,
      created_at
    FROM customer_requests
    WHERE category = 'special'
    ON CONFLICT (id) DO NOTHING;

    DELETE FROM customer_requests
    WHERE category = 'special';

    ALTER TABLE customer_requests DROP COLUMN IF EXISTS category;
    ALTER TABLE customer_requests DROP COLUMN IF EXISTS gender;
    ALTER TABLE customer_requests DROP COLUMN IF EXISTS name;
    ALTER TABLE customer_requests DROP COLUMN IF EXISTS age;
    ALTER TABLE customer_requests DROP COLUMN IF EXISTS residence;
    ALTER TABLE customer_requests DROP COLUMN IF EXISTS instagram;
    ALTER TABLE customer_requests DROP COLUMN IF EXISTS ideal_type;
  END IF;
END $$;
`)
	return err
}

func (r *Repository) SeedDefaults(ctx context.Context) error {
	var count int
	if err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM store_profile`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `INSERT INTO store_profile (id, name, subtitle, address) VALUES (1, $1, $2, $3)`,
		"laam", "혼술 바를 위한 QR 메뉴 초안", "서울 마포구 망원동 57-23"); err != nil {
		return err
	}

	categories := []lamdata.MenuCategory{
		{ID: "signature", Label: "대표", IsVisible: true},
		{ID: "food", Label: "안주", IsVisible: true},
		{ID: "highball", Label: "하이볼", IsVisible: true},
		{ID: "whisky", Label: "위스키", IsVisible: true},
		{ID: "wine", Label: "와인", IsVisible: true},
	}
	for index, category := range categories {
		if _, err := tx.Exec(ctx, `INSERT INTO menu_categories (id, label, is_visible, sort_order) VALUES ($1, $2, $3, $4)`, category.ID, category.Label, category.IsVisible, index+1); err != nil {
			return err
		}
	}

	items := []lamdata.MenuItem{
		{ID: "steak", CategoryID: "signature", Badge: "signature", Name: "laam 시그니처 스테이크", Description: "짙은 풍미의 스테이크와 구운 채소", Price: "29,000원", IsVisible: true},
		{ID: "truffle-fries", CategoryID: "signature", Badge: "best", Name: "트러플 프라이", Description: "가볍게 시작하기 좋은 인기 메뉴", Price: "11,000원"},
		{ID: "beef-tartare", CategoryID: "signature", Badge: "chef", Name: "비프 타르타르", Description: "고소한 노른자와 허브 오일을 곁들인 시그니처 플레이트", Price: "19,000원"},
		{ID: "octopus-carpaccio", CategoryID: "signature", Name: "문어 카르파초", Description: "산뜻한 시트러스 드레싱과 후추의 밸런스", Price: "21,000원"},
		{ID: "cheese-platter", CategoryID: "food", Badge: "share", Name: "치즈 플래터", Description: "와인과 잘 어울리는 치즈와 견과", Price: "18,000원"},
		{ID: "smoked-sausage", CategoryID: "food", Name: "훈제 소시지 플레이트", Description: "바삭한 감자와 머스터드 소스", Price: "16,000원"},
		{ID: "butter-squid", CategoryID: "food", Badge: "popular", Name: "버터 먹태구이", Description: "부드럽게 찢어 먹기 좋은 시그니처 건어물 안주", Price: "17,000원"},
		{ID: "spicy-pasta", CategoryID: "food", Name: "매콤 로제 파스타", Description: "늦은 밤에도 부담 없이 즐기기 좋은 한 접시", Price: "18,500원"},
		{ID: "truffle-potato", CategoryID: "food", Name: "트러플 감자전", Description: "겉은 바삭하고 속은 촉촉한 감자전 스타일 안주", Price: "15,500원"},
		{ID: "burrata-salad", CategoryID: "food", Badge: "fresh", Name: "부라타 토마토 샐러드", Description: "상큼한 토마토와 바질 페스토 조합", Price: "16,000원"},
		{ID: "house-highball", CategoryID: "highball", Badge: "today", Name: "하우스 하이볼", Description: "레몬 향을 더한 드라이한 밸런스", Price: "9,000원"},
		{ID: "yuzu-highball", CategoryID: "highball", Name: "유자 하이볼", Description: "상큼한 향과 부드러운 탄산감", Price: "10,000원"},
		{ID: "earlgrey-highball", CategoryID: "highball", Name: "얼그레이 하이볼", Description: "은은한 티 향이 길게 남는 시그니처 하이볼", Price: "11,000원"},
		{ID: "ginger-highball", CategoryID: "highball", Badge: "dry", Name: "진저 하이볼", Description: "진저 스파이스가 선명한 드라이 타입", Price: "10,500원"},
		{ID: "green-grape-highball", CategoryID: "highball", Name: "청포도 하이볼", Description: "달지 않고 깔끔하게 떨어지는 프루티 스타일", Price: "10,500원"},
		{ID: "smoky-highball", CategoryID: "highball", Badge: "limited", Name: "스모키 하이볼", Description: "피트 향을 가볍게 살린 한정 레시피", Price: "12,000원"},
		{ID: "apple-highball", CategoryID: "highball", Name: "애플 하이볼", Description: "은은한 사과 향과 산뜻한 탄산감", Price: "10,500원"},
		{ID: "grapefruit-highball", CategoryID: "highball", Badge: "citrus", Name: "자몽 하이볼", Description: "쌉쌀한 자몽 향이 또렷한 시트러스 스타일", Price: "10,500원"},
		{ID: "melon-highball", CategoryID: "highball", Name: "멜론 하이볼", Description: "부드럽고 달콤한 향이 가볍게 도는 타입", Price: "11,000원"},
		{ID: "plum-highball", CategoryID: "highball", Badge: "house", Name: "매실 하이볼", Description: "새콤한 매실 향으로 마무리가 깔끔한 하우스 레시피", Price: "10,000원"},
		{ID: "basil-lemon-highball", CategoryID: "highball", Name: "바질 레몬 하이볼", Description: "허브 향과 레몬의 산뜻함이 살아 있는 스타일", Price: "11,500원"},
		{ID: "pear-highball", CategoryID: "highball", Name: "배 하이볼", Description: "부드럽고 은은한 배 향이 길게 남는 타입", Price: "10,500원"},
		{ID: "cola-highball", CategoryID: "highball", Badge: "classic", Name: "콜라 하이볼", Description: "가볍고 편하게 마시기 좋은 클래식 변주", Price: "9,500원"},
		{ID: "coffee-highball", CategoryID: "highball", Badge: "late-night", Name: "콜드브루 하이볼", Description: "씁쓸한 커피 향과 위스키의 균형감이 또렷한 한 잔", Price: "12,000원"},
		{ID: "tonic-highball", CategoryID: "highball", Name: "토닉 하이볼", Description: "청량하고 드라이한 느낌을 선호할 때 추천", Price: "10,000원"},
		{ID: "seasonal-highball", CategoryID: "highball", Badge: "seasonal", Name: "시즌 하이볼", Description: "제철 과일이나 허브를 활용한 한정 레시피", Price: "12,500원"},
		{ID: "glass-whisky", CategoryID: "whisky", Badge: "glass", Name: "싱글몰트 위스키 1잔", Description: "오늘의 추천 라인업 중 선택", Price: "15,000원~"},
		{ID: "bourbon-flight", CategoryID: "whisky", Badge: "flight", Name: "버번 테이스팅 플라이트", Description: "세 가지 버번을 가볍게 비교해보는 구성", Price: "27,000원"},
		{ID: "peat-whisky", CategoryID: "whisky", Name: "피트 위스키 글라스", Description: "짙은 스모키 향을 좋아하는 손님 추천", Price: "18,000원~"},
		{ID: "japanese-whisky", CategoryID: "whisky", Name: "재패니즈 위스키 글라스", Description: "부드럽고 균형감 있는 스타일 위주로 구성", Price: "17,000원~"},
		{ID: "old-fashioned", CategoryID: "whisky", Badge: "classic", Name: "올드 패션드", Description: "오렌지 필과 비터스가 살아 있는 클래식", Price: "16,000원"},
		{ID: "house-wine", CategoryID: "wine", Badge: "glass", Name: "하우스 와인", Description: "레드 또는 화이트 글라스 선택", Price: "8,000원"},
		{ID: "sparkling-wine", CategoryID: "wine", Badge: "sparkling", Name: "스파클링 와인", Description: "가볍게 시작하기 좋은 산뜻한 버블", Price: "11,000원"},
		{ID: "orange-wine", CategoryID: "wine", Name: "오렌지 와인", Description: "향이 풍부하고 개성 있는 한 잔", Price: "12,000원"},
		{ID: "red-bottle", CategoryID: "wine", Name: "레드 와인 보틀", Description: "직원 추천 리스트 중 선택 가능", Price: "39,000원~"},
		{ID: "white-bottle", CategoryID: "wine", Name: "화이트 와인 보틀", Description: "산뜻한 타입부터 묵직한 타입까지 준비", Price: "37,000원~"},
		{ID: "white-bottle-2", CategoryID: "wine", Name: "화이트 와인 보틀", Description: "산뜻한 타입부터 묵직한 타입까지 준비", Price: "37,000원~"},
		{ID: "white-bottle-3", CategoryID: "wine", Name: "화이트 와인 보틀", Description: "산뜻한 타입부터 묵직한 타입까지 준비", Price: "37,000원~", IsVisible: true},
	}
	for index, item := range items {
		if _, err := tx.Exec(ctx, `INSERT INTO menu_items (id, category_id, badge, badge_color, name, description, price, is_visible, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			item.ID, item.CategoryID, nullable(item.Badge), nullable(item.BadgeColor), item.Name, item.Description, item.Price, item.IsVisible, index+1); err != nil {
			return err
		}
	}

	requestGuides := []lamdata.NoticeItem{
		{ID: "allergy", Text: "알레르기 유발 재료가 있으면 주문 전 꼭 말씀해주세요.", IsVisible: true},
		{ID: "soldout", Text: "일부 주류와 안주는 당일 재고에 따라 조기 품절될 수 있습니다.", IsVisible: true},
		{ID: "seat-time", Text: "혼술 손님 위주 운영 특성상 좌석 이동이 필요할 수 있습니다.", IsVisible: true},
		{ID: "pairing", Text: "주류 추천이 필요하면 취향에 맞춰 페어링을 도와드립니다.", IsVisible: true},
	}
	for index, item := range requestGuides {
		if _, err := tx.Exec(ctx, `INSERT INTO request_guides (id, text, is_visible, sort_order) VALUES ($1, $2, $3, $4)`, item.ID, item.Text, item.IsVisible, index+1); err != nil {
			return err
		}
	}

	notices := []lamdata.NoticeItem{
		{ID: "hours", Text: "평일 18:00 - 02:00 / 금토 18:00 - 03:00", IsVisible: true},
		{ID: "seat", Text: "혼술 손님이 편하게 머물 수 있도록 좌석 간격을 넉넉히 운영합니다.", IsVisible: true},
		{ID: "event-1", Text: "매주 화요일 하이볼 추천 메뉴 1,000원 할인", IsVisible: true},
		{ID: "event-2", Text: "비 오는 날에는 스모키 하이볼 한정 레시피가 추가됩니다.", IsVisible: true},
	}
	for index, item := range notices {
		if _, err := tx.Exec(ctx, `INSERT INTO notices (id, text, is_visible, sort_order) VALUES ($1, $2, $3, $4)`, item.ID, item.Text, item.IsVisible, index+1); err != nil {
			return err
		}
	}

	if err := seedSampleActivity(ctx, tx); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// seedSampleActivity seeds a handful of sample customer requests, special
// requests, and payment orders alongside SeedDefaults' menu/notice data —
// so a freshly started `docker compose` stack has something to look at in
// the admin web's request/order-history/sales-stats screens without the
// operator manually creating rows first. Only ever runs as part of
// SeedDefaults' own "store_profile is empty" guard, so it's exactly as
// one-shot/idempotent as the rest of that function.
func seedSampleActivity(ctx context.Context, tx pgx.Tx) error {
	type sampleRequest struct {
		id          string
		tableNumber string
		text        string
		status      string
		createdAgo  string
		handledAgo  string // "" when not yet handled
	}
	requests := []sampleRequest{
		{id: "sample-request-1", tableNumber: "3", text: "물 좀 더 주세요", status: "pending", createdAgo: "10 minutes"},
		{id: "sample-request-2", tableNumber: "5", text: "테이블 정리 부탁드려요", status: "checked", createdAgo: "40 minutes", handledAgo: "35 minutes"},
		{id: "sample-request-3", tableNumber: "2", text: "[노래 신청] Dynamite - BTS", status: "pending", createdAgo: "20 minutes"},
		{id: "sample-request-4", tableNumber: "7", text: "[노래 신청] Butter - BTS", status: "completed", createdAgo: "2 hours", handledAgo: "1 hour 50 minutes"},
		{id: "sample-request-5", tableNumber: "1", text: "메뉴 추천 부탁드려요", status: "completed", createdAgo: "3 hours", handledAgo: "2 hours 55 minutes"},
	}
	for _, r := range requests {
		if _, err := tx.Exec(ctx, `
			INSERT INTO customer_requests (id, table_number, text, status, created_at, handled_at)
			VALUES ($1, $2, $3, $4, NOW() - $5::interval, NOW() - NULLIF($6, '')::interval)
		`, r.id, r.tableNumber, r.text, r.status, r.createdAgo, r.handledAgo); err != nil {
			return err
		}
	}

	type sampleSpecialRequest struct {
		id          string
		tableNumber string
		gender      string
		name        string
		age         string
		residence   string
		instagram   string
		idealType   string
		text        string
		createdAgo  string
	}
	specialRequests := []sampleSpecialRequest{
		{id: "sample-special-1", tableNumber: "4", gender: "male", name: "김민준", age: "20대", residence: "서울", instagram: "@minjun_kim", idealType: "밝고 긍정적인 사람", text: "혹시 옆 테이블 분과 자리 바꿔도 될까요?", createdAgo: "30 minutes"},
		{id: "sample-special-2", tableNumber: "6", gender: "female", name: "이서연", age: "20대", residence: "인천", instagram: "@seoyeon.lee", idealType: "유머감각 있는 사람", text: "친구들이랑 같이 왔는데 자리 넓혀주실 수 있나요?", createdAgo: "1 hour 15 minutes"},
	}
	for _, s := range specialRequests {
		if _, err := tx.Exec(ctx, `
			INSERT INTO special_requests (id, table_number, gender, name, age, residence, instagram, ideal_type, text, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() - $10::interval)
		`, s.id, s.tableNumber, s.gender, s.name, s.age, s.residence, s.instagram, s.idealType, s.text, s.createdAgo); err != nil {
			return err
		}
	}

	type sampleDoneOrder struct {
		id             string
		tableNumber    string
		menuItemName   string
		categoryName   string
		amount         int64
		vat            int64
		suppliedAmount int64
		paymentMethod  string
		posSyncStatus  string
		posOrderID     string // "" when the sync failed/is unset
		posSyncError   string // "" when there was no sync error
		approvedAgo    string
	}
	doneOrders := []sampleDoneOrder{
		{id: "sample-order-1", tableNumber: "3", menuItemName: "하우스 하이볼", categoryName: "하이볼", amount: 9000, vat: 818, suppliedAmount: 8182, paymentMethod: "카드", posSyncStatus: "SUCCEEDED", posOrderID: "sample-pos-1", approvedAgo: "2 hours"},
		{id: "sample-order-2", tableNumber: "5", menuItemName: "트러플 프라이", categoryName: "대표", amount: 11000, vat: 1000, suppliedAmount: 10000, paymentMethod: "카드", posSyncStatus: "SUCCEEDED", posOrderID: "sample-pos-2", approvedAgo: "1 day 3 hours"},
		{id: "sample-order-3", tableNumber: "1", menuItemName: "버터 먹태구이", categoryName: "안주", amount: 17000, vat: 1545, suppliedAmount: 15455, paymentMethod: "간편결제", posSyncStatus: "SUCCEEDED", posOrderID: "sample-pos-3", approvedAgo: "2 days 5 hours"},
		{id: "sample-order-4", tableNumber: "2", menuItemName: "싱글몰트 위스키 1잔", categoryName: "위스키", amount: 15000, vat: 1364, suppliedAmount: 13636, paymentMethod: "카드", posSyncStatus: "SUCCEEDED", posOrderID: "sample-pos-4", approvedAgo: "3 days 1 hours"},
		{id: "sample-order-5", tableNumber: "4", menuItemName: "하우스 와인", categoryName: "와인", amount: 8000, vat: 727, suppliedAmount: 7273, paymentMethod: "간편결제", posSyncStatus: "SUCCEEDED", posOrderID: "sample-pos-5", approvedAgo: "4 days 6 hours"},
		{id: "sample-order-6", tableNumber: "3", menuItemName: "유자 하이볼", categoryName: "하이볼", amount: 10000, vat: 909, suppliedAmount: 9091, paymentMethod: "카드", posSyncStatus: "FAILED", posSyncError: "toss place request failed", approvedAgo: "5 days 2 hours"},
		{id: "sample-order-7", tableNumber: "6", menuItemName: "치즈 플래터", categoryName: "안주", amount: 18000, vat: 1636, suppliedAmount: 16364, paymentMethod: "카드", posSyncStatus: "SUCCEEDED", posOrderID: "sample-pos-7", approvedAgo: "6 days 4 hours"},
		{id: "sample-order-8", tableNumber: "7", menuItemName: "스파클링 와인", categoryName: "와인", amount: 11000, vat: 1000, suppliedAmount: 10000, paymentMethod: "간편결제", posSyncStatus: "SUCCEEDED", posOrderID: "sample-pos-8", approvedAgo: "8 days 30 minutes"},
	}
	for i, o := range doneOrders {
		paymentKey := fmt.Sprintf("sample-payment-key-%d", i+1)
		if _, err := tx.Exec(ctx, `
			INSERT INTO payment_orders (
				id, menu_item_name, category_name, table_number, amount, vat, supplied_amount,
				status, payment_method, payment_key, approved_at, pos_sync_status, pos_order_id, pos_sync_error, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DONE', $8, $9, NOW() - $10::interval, $11, NULLIF($12, ''), NULLIF($13, ''), NOW() - $10::interval)
		`, o.id, o.menuItemName, o.categoryName, o.tableNumber, o.amount, o.vat, o.suppliedAmount,
			o.paymentMethod, paymentKey, o.approvedAgo, o.posSyncStatus, o.posOrderID, o.posSyncError); err != nil {
			return err
		}
	}

	// One unpaid/abandoned order — a guest who reached the payment sheet
	// but never completed it — so the order-history screen's READY/"미결제"
	// filter has something to show too.
	if _, err := tx.Exec(ctx, `
		INSERT INTO payment_orders (
			id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, created_at
		) VALUES ('sample-order-9', '콜드브루 하이볼', '하이볼', '8', 12000, 'READY', 'PENDING', NOW() - INTERVAL '15 minutes')
	`); err != nil {
		return err
	}

	return nil
}

func (r *Repository) GetMenuData(ctx context.Context) (lamdata.MenuData, error) {
	bootstrap, err := r.GetBootstrapData(ctx)
	if err != nil {
		return lamdata.MenuData{}, err
	}

	return lamdata.MenuData{
		Store:      bootstrap.Store,
		Categories: bootstrap.Categories,
		Items:      bootstrap.Items,
	}, nil
}

func (r *Repository) UpdateStoreCopies(ctx context.Context, songRequestCopy string, requestCopy string, eventCopy string) error {
	if strings.TrimSpace(songRequestCopy) == "" || strings.TrimSpace(requestCopy) == "" || strings.TrimSpace(eventCopy) == "" {
		return ErrInvalidInput
	}

	result, err := r.pool.Exec(ctx, `UPDATE store_profile SET song_request_copy = $1, request_copy = $2, event_copy = $3 WHERE id = 1`, strings.TrimSpace(songRequestCopy), strings.TrimSpace(requestCopy), strings.TrimSpace(eventCopy))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}

	return nil
}

func (r *Repository) GetBootstrapData(ctx context.Context) (lamdata.BootstrapData, error) {
	storeInfo := lamdata.StoreInfo{}
	if err := r.pool.QueryRow(ctx, `SELECT name, subtitle, address, song_request_copy, request_copy, event_copy FROM store_profile WHERE id = 1`).Scan(
		&storeInfo.Name, &storeInfo.Subtitle, &storeInfo.Address, &storeInfo.SongRequestCopy, &storeInfo.RequestCopy, &storeInfo.EventCopy,
	); err != nil {
		return lamdata.BootstrapData{}, err
	}

	categoriesRows, err := r.pool.Query(ctx, `SELECT id, label, is_visible FROM menu_categories ORDER BY sort_order, id`)
	if err != nil {
		return lamdata.BootstrapData{}, err
	}
	defer categoriesRows.Close()

	categories := make([]lamdata.MenuCategory, 0)
	for categoriesRows.Next() {
		var item lamdata.MenuCategory
		if err := categoriesRows.Scan(&item.ID, &item.Label, &item.IsVisible); err != nil {
			return lamdata.BootstrapData{}, err
		}
		categories = append(categories, item)
	}

	menuRows, err := r.pool.Query(ctx, `SELECT id, category_id, COALESCE(badge, ''), COALESCE(badge_color, ''), name, description, price, COALESCE(toss_image_url, ''), is_visible FROM menu_items ORDER BY sort_order, id`)
	if err != nil {
		return lamdata.BootstrapData{}, err
	}
	defer menuRows.Close()

	items := make([]lamdata.MenuItem, 0)
	for menuRows.Next() {
		var item lamdata.MenuItem
		if err := menuRows.Scan(&item.ID, &item.CategoryID, &item.Badge, &item.BadgeColor, &item.Name, &item.Description, &item.Price, &item.ImageURL, &item.IsVisible); err != nil {
			return lamdata.BootstrapData{}, err
		}
		items = append(items, item)
	}

	imageRows, err := r.pool.Query(ctx, `SELECT id, menu_item_id, filename, mime_type, size_bytes, is_primary, display_area, focus_x, focus_y, sort_order FROM menu_item_images ORDER BY menu_item_id, is_primary DESC, sort_order, id`)
	if err != nil {
		return lamdata.BootstrapData{}, err
	}
	defer imageRows.Close()

	imagesByMenuItem := make(map[string][]lamdata.MenuImage)
	for imageRows.Next() {
		var image lamdata.MenuImage
		var menuItemID string
		if err := imageRows.Scan(&image.ID, &menuItemID, &image.Filename, &image.MimeType, &image.SizeBytes, &image.IsPrimary, &image.DisplayArea, &image.FocusX, &image.FocusY, &image.SortOrder); err != nil {
			return lamdata.BootstrapData{}, err
		}
		image.ContentURL = fmt.Sprintf("/api/v1/menu-images/%s/content", image.ID)
		imagesByMenuItem[menuItemID] = append(imagesByMenuItem[menuItemID], image)
	}

	for index := range items {
		items[index].Images = imagesByMenuItem[items[index].ID]
	}

	optionRows, err := r.pool.Query(ctx, `
		SELECT mio.menu_item_id, mo.id, mo.title, mo.is_required, mo.min_choices, mo.max_choices
		FROM menu_item_options mio
		JOIN menu_options mo ON mo.id = mio.option_id AND mo.is_enabled = TRUE
		ORDER BY mio.menu_item_id, mio.sort_order, mo.id
	`)
	if err != nil {
		return lamdata.BootstrapData{}, err
	}
	defer optionRows.Close()

	itemIndex := make(map[string]int, len(items))
	for index := range items {
		itemIndex[items[index].ID] = index
	}
	optionIndex := make(map[string]int)
	for optionRows.Next() {
		var menuItemID, optionID, optionTitle string
		var required bool
		var minChoices, maxChoices int
		if err := optionRows.Scan(&menuItemID, &optionID, &optionTitle, &required, &minChoices, &maxChoices); err != nil {
			return lamdata.BootstrapData{}, err
		}
		index, ok := itemIndex[menuItemID]
		if !ok {
			continue
		}
		key := menuItemID + "\x00" + optionID
		items[index].Options = append(items[index].Options, lamdata.MenuOption{
			ID: optionID, Title: optionTitle, Required: required,
			MinChoices: minChoices, MaxChoices: maxChoices,
			Choices: make([]lamdata.MenuOptionChoice, 0),
		})
		optionIndex[key] = len(items[index].Options) - 1
	}
	if err := optionRows.Err(); err != nil {
		return lamdata.BootstrapData{}, err
	}
	optionRows.Close()

	choiceRows, err := r.pool.Query(ctx, `
		SELECT mio.menu_item_id, moc.option_id, moc.id, moc.title, moc.price_value,
			moc.image_url, moc.quantity_enabled, moc.min_quantity, moc.max_quantity
		FROM menu_item_options mio
		JOIN menu_options mo ON mo.id = mio.option_id AND mo.is_enabled = TRUE
		JOIN menu_option_choices moc
			ON moc.option_id = mo.id AND moc.is_enabled = TRUE AND moc.state = 'ON_SALE'
		ORDER BY mio.menu_item_id, mio.sort_order, moc.sort_order, moc.id
	`)
	if err != nil {
		return lamdata.BootstrapData{}, err
	}
	defer choiceRows.Close()
	for choiceRows.Next() {
		var menuItemID, optionID string
		var choice lamdata.MenuOptionChoice
		if err := choiceRows.Scan(
			&menuItemID, &optionID, &choice.ID, &choice.Title, &choice.PriceValue,
			&choice.ImageURL, &choice.QuantityEnabled, &choice.MinQuantity, &choice.MaxQuantity,
		); err != nil {
			return lamdata.BootstrapData{}, err
		}
		index, ok := itemIndex[menuItemID]
		if !ok {
			continue
		}
		if position, ok := optionIndex[menuItemID+"\x00"+optionID]; ok {
			items[index].Options[position].Choices = append(items[index].Options[position].Choices, choice)
		}
	}
	if err := choiceRows.Err(); err != nil {
		return lamdata.BootstrapData{}, err
	}

	requestRows, err := r.pool.Query(ctx, `SELECT id, text, is_visible FROM request_guides ORDER BY sort_order, id`)
	if err != nil {
		return lamdata.BootstrapData{}, err
	}
	defer requestRows.Close()

	requestGuides := make([]lamdata.NoticeItem, 0)
	for requestRows.Next() {
		var item lamdata.NoticeItem
		if err := requestRows.Scan(&item.ID, &item.Text, &item.IsVisible); err != nil {
			return lamdata.BootstrapData{}, err
		}
		requestGuides = append(requestGuides, item)
	}

	noticeRows, err := r.pool.Query(ctx, `SELECT id, text, is_visible FROM notices ORDER BY sort_order, id`)
	if err != nil {
		return lamdata.BootstrapData{}, err
	}
	defer noticeRows.Close()

	notices := make([]lamdata.NoticeItem, 0)
	for noticeRows.Next() {
		var item lamdata.NoticeItem
		if err := noticeRows.Scan(&item.ID, &item.Text, &item.IsVisible); err != nil {
			return lamdata.BootstrapData{}, err
		}
		notices = append(notices, item)
	}

	return lamdata.BootstrapData{
		Store:         storeInfo,
		Categories:    categories,
		Items:         items,
		RequestGuides: requestGuides,
		Notices:       notices,
	}, nil
}

func (r *Repository) CreateCategory(ctx context.Context, id string, label string, isVisible bool) error {
	if id == "" || label == "" {
		return ErrInvalidInput
	}

	sortOrder, err := r.nextSortOrder(ctx, "menu_categories")
	if err != nil {
		return err
	}

	_, err = r.pool.Exec(ctx, `INSERT INTO menu_categories (id, label, is_visible, sort_order) VALUES ($1, $2, $3, $4)`, id, label, isVisible, sortOrder)
	return classifyError(err)
}

func (r *Repository) CreateMenuItem(ctx context.Context, input CreateMenuItemInput) error {
	if input.CategoryID == "" || input.Name == "" || input.Description == "" || input.Price == "" {
		return ErrInvalidInput
	}

	var exists bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM menu_categories WHERE id = $1)`, input.CategoryID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}

	sortOrder, err := r.nextSortOrder(ctx, "menu_items")
	if err != nil {
		return err
	}

	id := nextID("menu")
	_, err = r.pool.Exec(ctx, `INSERT INTO menu_items (id, category_id, badge, badge_color, name, description, price, is_visible, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		id, input.CategoryID, nullable(input.Badge), nullable(input.BadgeColor), input.Name, input.Description, input.Price, input.IsVisible, sortOrder)
	return classifyError(err)
}

func (r *Repository) CreateRequestGuide(ctx context.Context, text string, isVisible bool) error {
	if text == "" {
		return ErrInvalidInput
	}

	sortOrder, err := r.nextSortOrder(ctx, "request_guides")
	if err != nil {
		return err
	}

	id := nextID("request")
	_, err = r.pool.Exec(ctx, `INSERT INTO request_guides (id, text, is_visible, sort_order) VALUES ($1, $2, $3, $4)`, id, text, isVisible, sortOrder)
	return classifyError(err)
}

func (r *Repository) ListCustomerRequests(ctx context.Context) ([]lamdata.CustomerRequest, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			id,
			COALESCE(table_number, ''),
			COALESCE(text, ''),
			status,
			created_at,
			handled_at
		FROM customer_requests
		ORDER BY
			CASE status
				WHEN 'pending' THEN 0
				WHEN 'checked' THEN 1
				ELSE 2
			END,
			created_at DESC,
			id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	requests := make([]lamdata.CustomerRequest, 0)
	for rows.Next() {
		var item lamdata.CustomerRequest
		var createdAt time.Time
		var handledAt *time.Time
		if err := rows.Scan(
			&item.ID,
			&item.TableNumber,
			&item.Text,
			&item.Status,
			&createdAt,
			&handledAt,
		); err != nil {
			return nil, err
		}
		item.CreatedAt = formatTimestamp(createdAt)
		if handledAt != nil {
			item.HandledAt = formatTimestamp(*handledAt)
		}
		requests = append(requests, item)
	}

	return requests, rows.Err()
}

func (r *Repository) CreateCustomerRequest(ctx context.Context, tableNumber string, text string) error {
	if strings.TrimSpace(tableNumber) == "" || strings.TrimSpace(text) == "" {
		return ErrInvalidInput
	}

	id := nextID("customer-request")
	_, err := r.pool.Exec(ctx, `
		INSERT INTO customer_requests (id, table_number, text, status)
		VALUES ($1, $2, $3, 'pending')
	`, id, tableNumber, text)
	return classifyError(err)
}

func (r *Repository) GetSongRequestQuery(ctx context.Context, id string) (string, error) {
	if strings.TrimSpace(id) == "" {
		return "", ErrInvalidInput
	}

	var text string
	if err := r.pool.QueryRow(ctx, `SELECT text FROM customer_requests WHERE id = $1`, id).Scan(&text); err != nil {
		return "", classifyError(err)
	}
	if !strings.HasPrefix(text, songRequestPrefix) {
		return "", ErrInvalidInput
	}
	query := strings.TrimSpace(strings.TrimPrefix(text, songRequestPrefix))
	if query == "" {
		return "", ErrInvalidInput
	}
	return query, nil
}

func (r *Repository) QueueSongRequest(ctx context.Context, requestID string, input QueueSongRequestInput) (lamdata.SongQueueItem, error) {
	if strings.TrimSpace(requestID) == "" ||
		strings.TrimSpace(input.YouTubeVideoID) == "" ||
		strings.TrimSpace(input.YouTubeTitle) == "" {
		return lamdata.SongQueueItem{}, ErrInvalidInput
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return lamdata.SongQueueItem{}, err
	}
	defer tx.Rollback(ctx)

	var tableNumber, requestText, requestStatus string
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(table_number, ''), text, status
		FROM customer_requests
		WHERE id = $1
		FOR UPDATE
	`, requestID).Scan(&tableNumber, &requestText, &requestStatus); err != nil {
		return lamdata.SongQueueItem{}, classifyError(err)
	}
	if !strings.HasPrefix(requestText, songRequestPrefix) || requestStatus == "completed" {
		return lamdata.SongQueueItem{}, ErrInvalidInput
	}

	if existing, found, err := getSongQueueItemByRequestID(ctx, tx, requestID); err != nil {
		return lamdata.SongQueueItem{}, err
	} else if found {
		if err := tx.Commit(ctx); err != nil {
			return lamdata.SongQueueItem{}, err
		}
		return existing, nil
	}

	id := nextID("song-queue")
	var item lamdata.SongQueueItem
	var queuedAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO song_playback_queue (
			id, customer_request_id, youtube_video_id, youtube_title, youtube_channel_title
		)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, customer_request_id, youtube_video_id, youtube_title, youtube_channel_title, status, queued_at
	`, id, requestID, strings.TrimSpace(input.YouTubeVideoID), strings.TrimSpace(input.YouTubeTitle), strings.TrimSpace(input.YouTubeChannelTitle)).Scan(
		&item.ID,
		&item.CustomerRequestID,
		&item.YouTubeVideoID,
		&item.YouTubeTitle,
		&item.YouTubeChannelTitle,
		&item.Status,
		&queuedAt,
	)
	if err != nil {
		return lamdata.SongQueueItem{}, classifyError(err)
	}
	item.TableNumber = tableNumber
	item.RequestText = requestText
	item.QueuedAt = formatTimestamp(queuedAt)

	if _, err := tx.Exec(ctx, `
		UPDATE customer_requests
		SET status = 'checked', updated_at = NOW(), handled_at = NULL
		WHERE id = $1
	`, requestID); err != nil {
		return lamdata.SongQueueItem{}, classifyError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return lamdata.SongQueueItem{}, err
	}
	return item, nil
}

type songQueueQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func getSongQueueItemByRequestID(ctx context.Context, q songQueueQuerier, requestID string) (lamdata.SongQueueItem, bool, error) {
	item, err := scanSongQueueItem(q.QueryRow(ctx, `
		SELECT
			q.id,
			q.customer_request_id,
			COALESCE(r.table_number, ''),
			r.text,
			q.youtube_video_id,
			q.youtube_title,
			q.youtube_channel_title,
			q.status,
			q.queued_at,
			q.started_at,
			q.completed_at
		FROM song_playback_queue q
		JOIN customer_requests r ON r.id = q.customer_request_id
		WHERE q.customer_request_id = $1
	`, requestID))
	if errors.Is(err, pgx.ErrNoRows) {
		return lamdata.SongQueueItem{}, false, nil
	}
	return item, err == nil, err
}

func (r *Repository) ListActiveSongQueue(ctx context.Context) ([]lamdata.SongQueueItem, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			q.id,
			q.customer_request_id,
			COALESCE(r.table_number, ''),
			r.text,
			q.youtube_video_id,
			q.youtube_title,
			q.youtube_channel_title,
			q.status,
			q.queued_at,
			q.started_at,
			q.completed_at
		FROM song_playback_queue q
		JOIN customer_requests r ON r.id = q.customer_request_id
		WHERE q.status IN ('queued', 'playing')
		ORDER BY CASE q.status WHEN 'playing' THEN 0 ELSE 1 END, q.queued_at, q.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]lamdata.SongQueueItem, 0)
	for rows.Next() {
		item, err := scanSongQueueItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type songQueueScanner interface {
	Scan(...any) error
}

func scanSongQueueItem(row songQueueScanner) (lamdata.SongQueueItem, error) {
	var item lamdata.SongQueueItem
	var queuedAt time.Time
	var startedAt, completedAt *time.Time
	err := row.Scan(
		&item.ID,
		&item.CustomerRequestID,
		&item.TableNumber,
		&item.RequestText,
		&item.YouTubeVideoID,
		&item.YouTubeTitle,
		&item.YouTubeChannelTitle,
		&item.Status,
		&queuedAt,
		&startedAt,
		&completedAt,
	)
	if err != nil {
		return lamdata.SongQueueItem{}, err
	}
	item.QueuedAt = formatTimestamp(queuedAt)
	if startedAt != nil {
		item.StartedAt = formatTimestamp(*startedAt)
	}
	if completedAt != nil {
		item.CompletedAt = formatTimestamp(*completedAt)
	}
	return item, nil
}

func (r *Repository) UpdateSongQueueStatus(ctx context.Context, id string, status string) error {
	if strings.TrimSpace(id) == "" || !isValidSongPlaybackStatus(status) {
		return ErrInvalidInput
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var requestID string
	if err := tx.QueryRow(ctx, `
		UPDATE song_playback_queue
		SET status = $2,
			started_at = CASE WHEN $2 = 'playing' THEN COALESCE(started_at, NOW()) ELSE started_at END,
			completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE NULL END
		WHERE id = $1
		RETURNING customer_request_id
	`, id, status).Scan(&requestID); err != nil {
		return classifyError(err)
	}

	if status == "completed" {
		if _, err := tx.Exec(ctx, `
			UPDATE customer_requests
			SET status = 'completed', updated_at = NOW(), handled_at = NOW()
			WHERE id = $1
		`, requestID); err != nil {
			return classifyError(err)
		}
	}

	return tx.Commit(ctx)
}

func (r *Repository) ListSpecialRequests(ctx context.Context) ([]lamdata.SpecialRequest, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			id,
			COALESCE(table_number, ''),
			gender,
			name,
			age,
			residence,
			instagram,
			ideal_type,
			text,
			created_at
		FROM special_requests
		ORDER BY created_at DESC, id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	requests := make([]lamdata.SpecialRequest, 0)
	for rows.Next() {
		var item lamdata.SpecialRequest
		var createdAt time.Time
		if err := rows.Scan(
			&item.ID,
			&item.TableNumber,
			&item.Gender,
			&item.Name,
			&item.Age,
			&item.Residence,
			&item.Instagram,
			&item.IdealType,
			&item.Text,
			&createdAt,
		); err != nil {
			return nil, err
		}
		item.CreatedAt = formatTimestamp(createdAt)
		requests = append(requests, item)
	}

	return requests, rows.Err()
}

// songRequestPrefix is the one place this repository knows about the
// "song request" convention: it is not a separate resource, just a
// customer_requests row whose text starts with this literal. Must stay in
// sync with the identical constant in lam-admin-web's
// features/dashboard/summary.ts — a drift here silently empties the
// kind=song / kind=general filters below.
const songRequestPrefix = "[노래 신청]"

// CustomerRequestFilter is the validated, store-layer form of an admin
// customer-request list query. Callers (httpapi) are expected to have
// already validated Sort/Order/Kind/Status against a fixed whitelist;
// ListCustomerRequestsPage re-validates Sort/Order itself before touching
// SQL, since an unrecognized value here would otherwise have no safe
// ORDER BY translation.
type CustomerRequestFilter struct {
	Status   string // "" = all statuses
	Kind     string // "all" | "general" | "song"
	Search   string
	From     *time.Time // inclusive; nil = no lower bound
	To       *time.Time // exclusive; nil = no upper bound
	Sort     string     // "status" | "createdAt" | "tableNumber"
	Order    string     // "asc" | "desc"
	Page     int
	PageSize int
}

// SpecialRequestFilter is the equivalent validated filter for
// ListSpecialRequestsPage.
type SpecialRequestFilter struct {
	Gender   string // "" = both genders
	Search   string
	From     *time.Time // inclusive; nil = no lower bound
	To       *time.Time // exclusive; nil = no upper bound
	Sort     string     // "createdAt" | "name"
	Order    string     // "asc" | "desc"
	Page     int
	PageSize int
}

// escapeLikePattern escapes the characters ILIKE treats specially (\, %, _)
// so a user-typed search term is matched literally once wrapped in
// "%"+escaped+"%", rather than as a LIKE pattern of its own.
func escapeLikePattern(input string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(input)
}

func searchPatternOrEmpty(search string) string {
	if strings.TrimSpace(search) == "" {
		return ""
	}
	return "%" + escapeLikePattern(search) + "%"
}

func clampListPage(page int) int {
	if page < 1 {
		return 1
	}
	return page
}

func clampListPageSize(pageSize int) int {
	if pageSize < 1 {
		return 20
	}
	if pageSize > 100 {
		return 100
	}
	return pageSize
}

func customerRequestOrderByClause(sort string, order string) (string, error) {
	direction := "DESC"
	if order == "asc" {
		direction = "ASC"
	} else if order != "desc" && order != "" {
		return "", fmt.Errorf("%w: order %q", ErrInvalidInput, order)
	}

	switch sort {
	case "status", "":
		return "CASE status WHEN 'pending' THEN 0 WHEN 'checked' THEN 1 ELSE 2 END " + direction + ", created_at DESC, id DESC", nil
	case "createdAt":
		return "created_at " + direction + ", id " + direction, nil
	case "tableNumber":
		return "table_number " + direction + ", created_at DESC, id DESC", nil
	default:
		return "", fmt.Errorf("%w: sort %q", ErrInvalidInput, sort)
	}
}

func specialRequestOrderByClause(sort string, order string) (string, error) {
	direction := "DESC"
	if order == "asc" {
		direction = "ASC"
	} else if order != "desc" && order != "" {
		return "", fmt.Errorf("%w: order %q", ErrInvalidInput, order)
	}

	switch sort {
	case "createdAt", "":
		return "created_at " + direction + ", id " + direction, nil
	case "name":
		return "name " + direction + ", created_at DESC, id DESC", nil
	default:
		return "", fmt.Errorf("%w: sort %q", ErrInvalidInput, sort)
	}
}

const customerRequestFilterWhere = `
	WHERE ($1 = '' OR status = $1)
	  AND (
	    $2 = 'all' OR $2 = ''
	    OR ($2 = 'song' AND starts_with(text, $3))
	    OR ($2 = 'general' AND NOT starts_with(text, $3))
	  )
	  AND ($4 = '' OR text ILIKE $4 ESCAPE '\' OR table_number ILIKE $4 ESCAPE '\')
	  AND ($5::timestamptz IS NULL OR created_at >= $5)
	  AND ($6::timestamptz IS NULL OR created_at < $6)
`

// ListCustomerRequestsPage applies filter/search/sort/pagination server-side
// and reports the total matching row count alongside the current page, so
// callers can render page controls without a second round trip. Unlike
// ListCustomerRequests (kept as-is for the no-parameters/legacy-array
// response path), this is only reached when the caller supplied at least
// one recognized query parameter.
func (r *Repository) ListCustomerRequestsPage(ctx context.Context, filter CustomerRequestFilter) ([]lamdata.CustomerRequest, int, error) {
	orderBy, err := customerRequestOrderByClause(filter.Sort, filter.Order)
	if err != nil {
		return nil, 0, err
	}

	page := clampListPage(filter.Page)
	pageSize := clampListPageSize(filter.PageSize)
	searchPattern := searchPatternOrEmpty(filter.Search)

	var total int
	countSQL := "SELECT COUNT(*) FROM customer_requests" + customerRequestFilterWhere
	if err := r.pool.QueryRow(ctx, countSQL, filter.Status, filter.Kind, songRequestPrefix, searchPattern, filter.From, filter.To).Scan(&total); err != nil {
		return nil, 0, err
	}

	listSQL := `
		SELECT id, COALESCE(table_number, ''), COALESCE(text, ''), status, created_at, handled_at
		FROM customer_requests
	` + customerRequestFilterWhere + `
		ORDER BY ` + orderBy + `
		LIMIT $7 OFFSET $8
	`
	offset := (page - 1) * pageSize
	rows, err := r.pool.Query(ctx, listSQL, filter.Status, filter.Kind, songRequestPrefix, searchPattern, filter.From, filter.To, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	requests := make([]lamdata.CustomerRequest, 0)
	for rows.Next() {
		var item lamdata.CustomerRequest
		var createdAt time.Time
		var handledAt *time.Time
		if err := rows.Scan(
			&item.ID,
			&item.TableNumber,
			&item.Text,
			&item.Status,
			&createdAt,
			&handledAt,
		); err != nil {
			return nil, 0, err
		}
		item.CreatedAt = formatTimestamp(createdAt)
		if handledAt != nil {
			item.HandledAt = formatTimestamp(*handledAt)
		}
		requests = append(requests, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return requests, total, nil
}

const specialRequestFilterWhere = `
	WHERE ($1 = '' OR gender = $1)
	  AND (
	    $2 = ''
	    OR name ILIKE $2 ESCAPE '\'
	    OR table_number ILIKE $2 ESCAPE '\'
	    OR instagram ILIKE $2 ESCAPE '\'
	    OR residence ILIKE $2 ESCAPE '\'
	    OR text ILIKE $2 ESCAPE '\'
	  )
	  AND ($3::timestamptz IS NULL OR created_at >= $3)
	  AND ($4::timestamptz IS NULL OR created_at < $4)
`

// ListSpecialRequestsPage is the special_requests equivalent of
// ListCustomerRequestsPage. See that method's doc comment for the
// legacy-array-vs-envelope split this only ever serves the envelope side of.
func (r *Repository) ListSpecialRequestsPage(ctx context.Context, filter SpecialRequestFilter) ([]lamdata.SpecialRequest, int, error) {
	orderBy, err := specialRequestOrderByClause(filter.Sort, filter.Order)
	if err != nil {
		return nil, 0, err
	}

	page := clampListPage(filter.Page)
	pageSize := clampListPageSize(filter.PageSize)
	searchPattern := searchPatternOrEmpty(filter.Search)

	var total int
	countSQL := "SELECT COUNT(*) FROM special_requests" + specialRequestFilterWhere
	if err := r.pool.QueryRow(ctx, countSQL, filter.Gender, searchPattern, filter.From, filter.To).Scan(&total); err != nil {
		return nil, 0, err
	}

	listSQL := `
		SELECT id, COALESCE(table_number, ''), gender, name, age, residence, instagram, ideal_type, text, created_at
		FROM special_requests
	` + specialRequestFilterWhere + `
		ORDER BY ` + orderBy + `
		LIMIT $5 OFFSET $6
	`
	offset := (page - 1) * pageSize
	rows, err := r.pool.Query(ctx, listSQL, filter.Gender, searchPattern, filter.From, filter.To, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	requests := make([]lamdata.SpecialRequest, 0)
	for rows.Next() {
		var item lamdata.SpecialRequest
		var createdAt time.Time
		if err := rows.Scan(
			&item.ID,
			&item.TableNumber,
			&item.Gender,
			&item.Name,
			&item.Age,
			&item.Residence,
			&item.Instagram,
			&item.IdealType,
			&item.Text,
			&createdAt,
		); err != nil {
			return nil, 0, err
		}
		item.CreatedAt = formatTimestamp(createdAt)
		requests = append(requests, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return requests, total, nil
}

func (r *Repository) CreateSpecialRequest(ctx context.Context, input lamdata.SpecialRequest) error {
	if strings.TrimSpace(input.TableNumber) == "" ||
		!isValidCustomerRequestGender(input.Gender) ||
		strings.TrimSpace(input.Name) == "" ||
		strings.TrimSpace(input.Age) == "" ||
		strings.TrimSpace(input.Residence) == "" ||
		strings.TrimSpace(input.Instagram) == "" ||
		strings.TrimSpace(input.IdealType) == "" ||
		strings.TrimSpace(input.Text) == "" {
		return ErrInvalidInput
	}

	id := nextID("special-request")
	_, err := r.pool.Exec(ctx, `
		INSERT INTO special_requests (id, table_number, gender, name, age, residence, instagram, ideal_type, text)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`,
		id,
		input.TableNumber,
		input.Gender,
		input.Name,
		input.Age,
		input.Residence,
		input.Instagram,
		input.IdealType,
		input.Text,
	)
	return classifyError(err)
}

func (r *Repository) UpdateCustomerRequestStatus(ctx context.Context, id string, status string) error {
	if strings.TrimSpace(id) == "" || !isValidCustomerRequestStatus(status) {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `
		UPDATE customer_requests
		SET status = $2,
			updated_at = NOW(),
			handled_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE NULL END
		WHERE id = $1
	`, id, status)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// maxBulkCustomerRequestIDs bounds a single bulk status update so one
// request can't force an unbounded IN-list onto the database.
const maxBulkCustomerRequestIDs = 200

// UpdateCustomerRequestStatuses applies status to every id in one statement.
// Unlike UpdateCustomerRequestStatus, an id with no matching row is silently
// ignored rather than reported as ErrNotFound: callers pass ids gathered
// from a list they already fetched, and one request deleted in the
// meantime must not fail the update for the rest.
func (r *Repository) UpdateCustomerRequestStatuses(ctx context.Context, ids []string, status string) error {
	if len(ids) == 0 || len(ids) > maxBulkCustomerRequestIDs || !isValidCustomerRequestStatus(status) {
		return ErrInvalidInput
	}

	_, err := r.pool.Exec(ctx, `
		UPDATE customer_requests
		SET status = $2,
			updated_at = NOW(),
			handled_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE NULL END
		WHERE id = ANY($1)
	`, ids, status)
	return classifyError(err)
}

func (r *Repository) DeleteCustomerRequest(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `DELETE FROM customer_requests WHERE id = $1`, id)
	if err != nil {
		return classifyError(err)
	}

	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	return nil
}

func (r *Repository) DeleteSpecialRequest(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `DELETE FROM special_requests WHERE id = $1`, id)
	if err != nil {
		return classifyError(err)
	}

	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	return nil
}

func (r *Repository) CreateNotice(ctx context.Context, text string, isVisible bool) error {
	if text == "" {
		return ErrInvalidInput
	}

	sortOrder, err := r.nextSortOrder(ctx, "notices")
	if err != nil {
		return err
	}

	id := nextID("notice")
	_, err = r.pool.Exec(ctx, `INSERT INTO notices (id, text, is_visible, sort_order) VALUES ($1, $2, $3, $4)`, id, text, isVisible, sortOrder)
	return classifyError(err)
}

func (r *Repository) UpdateNotice(ctx context.Context, id string, text string) error {
	if strings.TrimSpace(id) == "" || strings.TrimSpace(text) == "" {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `UPDATE notices SET text = $2 WHERE id = $1`, id, text)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) UpdateCategoryVisibility(ctx context.Context, id string, isVisible bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE menu_categories SET is_visible = $2 WHERE id = $1`, id, isVisible)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) UpdateMenuItemVisibility(ctx context.Context, id string, isVisible bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE menu_items SET is_visible = $2 WHERE id = $1`, id, isVisible)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetMenuItemRecipe returns the admin-only ingredients/method text for a
// menu item. It is not part of the public bootstrap/menu responses.
func (r *Repository) GetMenuItemRecipe(ctx context.Context, id string) (lamdata.MenuItemRecipe, error) {
	recipe := lamdata.MenuItemRecipe{MenuItemID: id}
	err := r.pool.QueryRow(ctx, `SELECT recipe_ingredients, recipe_instructions FROM menu_items WHERE id = $1`, id).Scan(
		&recipe.Ingredients, &recipe.Instructions,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return lamdata.MenuItemRecipe{}, ErrNotFound
	}
	if err != nil {
		return lamdata.MenuItemRecipe{}, err
	}
	return recipe, nil
}

func (r *Repository) UpdateMenuItemRecipe(ctx context.Context, id string, ingredients string, instructions string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE menu_items SET recipe_ingredients = $2, recipe_instructions = $3 WHERE id = $1`, id, ingredients, instructions)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) UpdateRequestGuideVisibility(ctx context.Context, id string, isVisible bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE request_guides SET is_visible = $2 WHERE id = $1`, id, isVisible)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) UpdateNoticeVisibility(ctx context.Context, id string, isVisible bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE notices SET is_visible = $2 WHERE id = $1`, id, isVisible)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Image
func (r *Repository) CreateMenuImage(ctx context.Context, input CreateMenuImageInput) error {
	if input.MenuItemID == "" || input.Filename == "" || input.MimeType == "" || len(input.Content) == 0 {
		return ErrInvalidInput
	}
	if input.DisplayArea != "home" && input.DisplayArea != "menu" && input.DisplayArea != "both" {
		input.DisplayArea = "menu"
	}
	input.FocusX = clampImageFocus(input.FocusX)
	input.FocusY = clampImageFocus(input.FocusY)

	var exists bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM menu_items WHERE id = $1)`, input.MenuItemID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}

	sortOrder, err := r.nextMenuImageSortOrder(ctx, input.MenuItemID)
	if err != nil {
		return err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if input.IsPrimary {
		if _, err := tx.Exec(ctx, `UPDATE menu_item_images SET is_primary = FALSE WHERE menu_item_id = $1`, input.MenuItemID); err != nil {
			return err
		}
	}

	id := nextID("image")
	_, err = tx.Exec(ctx, `
		INSERT INTO menu_item_images (id, menu_item_id, filename, mime_type, content, size_bytes, is_primary, display_area, focus_x, focus_y, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, id, input.MenuItemID, input.Filename, input.MimeType, input.Content, len(input.Content), input.IsPrimary, input.DisplayArea, input.FocusX, input.FocusY, sortOrder)
	if err != nil {
		return classifyError(err)
	}

	return tx.Commit(ctx)
}

func (r *Repository) GetMenuImageContent(ctx context.Context, imageID string) (MenuImageContent, error) {
	if strings.TrimSpace(imageID) == "" {
		return MenuImageContent{}, ErrInvalidInput
	}

	var content MenuImageContent
	if err := r.pool.QueryRow(ctx, `SELECT filename, mime_type, content FROM menu_item_images WHERE id = $1`, imageID).Scan(
		&content.Filename,
		&content.MimeType,
		&content.Content,
	); err != nil {
		return MenuImageContent{}, classifyError(err)
	}

	return content, nil
}

// DELETE
func (r *Repository) DeleteCategory(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `DELETE FROM menu_categories WHERE id = $1`, id)
	if err != nil {
		return classifyError(err)
	}

	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	return nil
}

func (r *Repository) DeleteMenuItem(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `DELETE FROM menu_items WHERE id = $1`, id)
	if err != nil {
		return classifyError(err)
	}

	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	return nil
}

func (r *Repository) DeleteRequestGuide(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `DELETE FROM request_guides WHERE id = $1`, id)
	if err != nil {
		return classifyError(err)
	}

	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	return nil
}

func (r *Repository) DeleteNotice(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `DELETE FROM notices WHERE id = $1`, id)
	if err != nil {
		return classifyError(err)
	}

	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	return nil
}

func (r *Repository) nextSortOrder(ctx context.Context, table string) (int, error) {
	var query string
	switch table {
	case "menu_categories":
		query = `SELECT COALESCE(MAX(sort_order), 0) + 1 FROM menu_categories`
	case "menu_items":
		query = `SELECT COALESCE(MAX(sort_order), 0) + 1 FROM menu_items`
	case "request_guides":
		query = `SELECT COALESCE(MAX(sort_order), 0) + 1 FROM request_guides`
	case "notices":
		query = `SELECT COALESCE(MAX(sort_order), 0) + 1 FROM notices`
	default:
		return 0, ErrInvalidInput
	}

	var sortOrder int
	if err := r.pool.QueryRow(ctx, query).Scan(&sortOrder); err != nil {
		return 0, err
	}

	return sortOrder, nil
}

func (r *Repository) nextMenuImageSortOrder(ctx context.Context, menuItemID string) (int, error) {
	var sortOrder int
	if err := r.pool.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), 0) + 1 FROM menu_item_images WHERE menu_item_id = $1`, menuItemID).Scan(&sortOrder); err != nil {
		return 0, err
	}

	return sortOrder, nil
}

func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func clampImageFocus(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func isValidCustomerRequestStatus(status string) bool {
	switch status {
	case "pending", "checked", "completed":
		return true
	default:
		return false
	}
}

func isValidSongPlaybackStatus(status string) bool {
	return status == "playing" || status == "completed"
}

func isValidCustomerRequestGender(gender string) bool {
	switch gender {
	case "male", "female":
		return true
	default:
		return false
	}
}

func formatTimestamp(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func classifyError(err error) error {
	if err == nil {
		return nil
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrAlreadyExists
	}

	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}

	return err
}
