-- 로컬 계산서(pos_bills) 테스트 데이터.
--
-- 관리자 웹의 주문내역 메뉴별/계산서별 보기, 계산서 상세(/orders/bills/{id}),
-- 결제수단 라벨, 매출 통계를 실제 결제 없이 확인하기 위한 데이터다. 모든 id는
-- 'seed-'로 시작하므로 reset.sql이 이 데이터만 지운다. 직접 실행하지 말고
-- seed.sh로 실행한다(로컬 DB 확인, reset 선행, 트랜잭션을 seed.sh가 붙인다).
--
-- 시각은 실행 시점 기준 "현재 영업일"(16:00-06:00 KST, 06:00 전이면 전날)의
-- 1-4 영업일 전으로 배치한다. 이미 끝난 영업일이라 미래 시각이 생기지 않고,
-- 관리자 웹 기본 조회 범위(최근 7 영업일) 안에 들어온다. 결제 대기 계산서(07)만
-- 실행 시각 40분 전에 연다.
--
-- 기대 매출(범위에 시드만 있을 때, 결제 기준):
--   CARD 83,000 / CASH 107,000 / ACCOUNT_TRANSFER 32,000 / BARCODE 51,000 /
--   POS(미확인) 69,000 = 합계 342,000원, 완료 메뉴 행 23건.

-- days_ago 영업일 전 영업일 날짜의 00:00 KST + at. at에 '25:10'처럼 24시간을
-- 넘기면 다음 날 새벽(같은 영업일)이 된다.
CREATE FUNCTION pg_temp.seed_at(days_ago INTEGER, at INTERVAL) RETURNS TIMESTAMPTZ
LANGUAGE SQL STABLE AS $$
  SELECT ((((NOW() AT TIME ZONE 'Asia/Seoul') - INTERVAL '6 hours')::date - days_ago)::timestamp + at)
    AT TIME ZONE 'Asia/Seoul'
$$;

-- 계산서. payments_synced_at이 있으면 매출 통계가 pos_payments(APPROVED)를 쓰고,
-- 없으면 메뉴 금액으로 대체한다.
INSERT INTO pos_bills (
  id, pos_order_id, table_number, status, opened_at, completed_at, cancelled_at,
  total_amount, discount_amount, payments_synced_at, payment_sync_attempted_at, created_at, updated_at
)
SELECT id, pos_order_id, table_number, status, opened_at, completed_at, cancelled_at,
  total_amount, discount_amount, payments_synced_at, payment_sync_attempted_at, opened_at,
  COALESCE(cancelled_at, completed_at, opened_at)
FROM (VALUES
  -- 1. 카드 단독 결제, 메뉴 3개
  ('seed-bill-01', 'seed-pos-01', 'T-01', 'PAID',
    pg_temp.seed_at(1, '19:10'), pg_temp.seed_at(1, '21:40'), NULL::timestamptz,
    48000::bigint, 0::bigint, pg_temp.seed_at(1, '21:40:05'), pg_temp.seed_at(1, '21:40:05')),
  -- 2. 카드 + 현금 분할 결제(추가 주문 포함)
  ('seed-bill-02', 'seed-pos-02', 'T-03', 'PAID',
    pg_temp.seed_at(1, '20:30'), pg_temp.seed_at(1, '23:50'), NULL,
    55000, 0, pg_temp.seed_at(1, '23:50:05'), pg_temp.seed_at(1, '23:50:05')),
  -- 3. 계좌이체
  ('seed-bill-03', 'seed-pos-03', 'B-03', 'PAID',
    pg_temp.seed_at(2, '21:00'), pg_temp.seed_at(2, '23:10'), NULL,
    32000, 0, pg_temp.seed_at(2, '23:10:05'), pg_temp.seed_at(2, '23:10:05')),
  -- 4. 현금 + POS 할인 5,000원(메뉴 50,000 / 결제 45,000)
  ('seed-bill-04', 'seed-pos-04', 'T-05', 'PAID',
    pg_temp.seed_at(2, '19:30'), pg_temp.seed_at(2, '22:00'), NULL,
    45000, 5000, pg_temp.seed_at(2, '22:00:05'), pg_temp.seed_at(2, '22:00:05')),
  -- 5. 카드 결제 취소 후 현금 재결제
  ('seed-bill-05', 'seed-pos-05', 'B-01', 'PAID',
    pg_temp.seed_at(3, '20:00'), pg_temp.seed_at(3, '22:30'), NULL,
    42000, 0, pg_temp.seed_at(3, '22:30:05'), pg_temp.seed_at(3, '22:30:05')),
  -- 6. 환불(계산서·메뉴·결제 모두 취소)
  ('seed-bill-06', 'seed-pos-06', 'T-02', 'CANCELLED',
    pg_temp.seed_at(3, '21:00'), pg_temp.seed_at(3, '22:00'), pg_temp.seed_at(3, '22:40'),
    29000, 0, pg_temp.seed_at(3, '22:40:05'), pg_temp.seed_at(3, '22:40:05')),
  -- 7. 결제 대기(OPEN), 결제 없음
  ('seed-bill-07', 'seed-pos-07', 'T-07', 'OPEN',
    NOW() - INTERVAL '40 minutes', NULL, NULL,
    NULL, NULL, NULL, NULL),
  -- 8. 결제 완료지만 결제 목록 미동기화(payments_synced_at NULL). 결제 이벤트로
  --    받은 카드 20,000원만 있고, 통계는 메뉴 금액(POS 37,000)으로 대체된다.
  ('seed-bill-08', 'seed-pos-08', 'T-04', 'PAID',
    pg_temp.seed_at(1, '22:00'), pg_temp.seed_at(1, '25:10'), NULL,
    NULL, NULL, NULL, NOW()),
  -- 9. 간편결제(BARCODE) + POS에서 직접 찍은 메뉴 1줄
  ('seed-bill-09', 'seed-pos-09', 'B-02', 'PAID',
    pg_temp.seed_at(4, '20:10'), pg_temp.seed_at(4, '21:30'), NULL,
    51000, 0, pg_temp.seed_at(4, '21:30:05'), pg_temp.seed_at(4, '21:30:05'))
) AS v(id, pos_order_id, table_number, status, opened_at, completed_at, cancelled_at,
  total_amount, discount_amount, payments_synced_at, payment_sync_attempted_at);

-- 결제. tax_amount는 부가세 포함 금액의 1/11.
INSERT INTO pos_payments (
  id, bill_id, state, source_type, payment_method, card_brand, amount,
  tax_amount, supply_amount, tax_exempt_amount, approved_no, approved_at, cancelled_at, created_at, updated_at
)
SELECT id, bill_id, state, source_type, payment_method, card_brand, amount,
  amount / 11, amount - amount / 11, 0, approved_no, approved_at, cancelled_at, approved_at,
  COALESCE(cancelled_at, approved_at)
FROM (VALUES
  ('seed-pay-01-1', 'seed-bill-01', 'APPROVED', 'CARD', '신용카드', '신한', 48000::bigint, '30010001',
    pg_temp.seed_at(1, '21:40'), NULL::timestamptz),
  ('seed-pay-02-1', 'seed-bill-02', 'APPROVED', 'CARD', '신용카드', 'KB국민', 35000, '30010002',
    pg_temp.seed_at(1, '23:48'), NULL),
  ('seed-pay-02-2', 'seed-bill-02', 'APPROVED', 'CASH', '현금', '', 20000, '',
    pg_temp.seed_at(1, '23:50'), NULL),
  ('seed-pay-03-1', 'seed-bill-03', 'APPROVED', 'ACCOUNT_TRANSFER', '계좌이체', '', 32000, '',
    pg_temp.seed_at(2, '23:10'), NULL),
  ('seed-pay-04-1', 'seed-bill-04', 'APPROVED', 'CASH', '현금', '', 45000, '',
    pg_temp.seed_at(2, '22:00'), NULL),
  ('seed-pay-05-1', 'seed-bill-05', 'CANCELLED', 'CARD', '신용카드', '현대', 42000, '30010005',
    pg_temp.seed_at(3, '22:20'), pg_temp.seed_at(3, '22:25')),
  ('seed-pay-05-2', 'seed-bill-05', 'APPROVED', 'CASH', '현금', '', 42000, '',
    pg_temp.seed_at(3, '22:30'), NULL),
  ('seed-pay-06-1', 'seed-bill-06', 'CANCELLED', 'CARD', '신용카드', '삼성', 29000, '30010006',
    pg_temp.seed_at(3, '22:00'), pg_temp.seed_at(3, '22:40')),
  ('seed-pay-08-1', 'seed-bill-08', 'APPROVED', 'CARD', '신용카드', 'BC', 20000, '30010008',
    pg_temp.seed_at(1, '25:05'), NULL),
  ('seed-pay-09-1', 'seed-bill-09', 'APPROVED', 'BARCODE', '간편결제', '', 51000, '30010009',
    pg_temp.seed_at(4, '21:30'), NULL)
) AS v(id, bill_id, state, source_type, payment_method, card_brand, amount, approved_no, approved_at, cancelled_at);

-- 계산서에 붙은 메뉴 행. 시각·테이블·POS 주문 id는 계산서에서 가져온다.
-- DONE/CANCELLED 행은 실제 동기화처럼 payment_method 'POS', approved_at은
-- 계산서 완료 시각이다. table_number ''인 행(seed-order-09-3)은 POS에서 직접 찍은
-- 메뉴(menu_item_id NULL)다.
INSERT INTO payment_orders (
  id, menu_item_name, category_name, table_number, request_note, amount, status,
  payment_method, approved_at, vat, supplied_amount, tax_free_amount,
  pos_sync_status, pos_order_id, bill_id, created_at, updated_at
)
SELECT v.id, v.menu_item_name, v.category_name, COALESCE(v.table_number, b.table_number), v.request_note,
  v.amount, v.status,
  CASE WHEN v.status IN ('DONE', 'CANCELLED') THEN 'POS' END,
  CASE WHEN v.status IN ('DONE', 'CANCELLED') THEN b.completed_at END,
  v.amount / 11, v.amount - v.amount / 11, 0,
  'SUCCEEDED', b.pos_order_id, b.id, b.opened_at + v.ordered_after,
  COALESCE(b.cancelled_at, b.completed_at, b.opened_at + v.ordered_after)
FROM (VALUES
  ('seed-order-01-1', 'seed-bill-01', '하이볼', '주류', 15000::bigint, 'DONE', NULL::text, '', INTERVAL '0 minutes'),
  ('seed-order-01-2', 'seed-bill-01', '감바스 알 아히요', '안주', 25000, 'DONE', NULL, '바게트 추가로 주세요', INTERVAL '1 minute'),
  ('seed-order-01-3', 'seed-bill-01', '생맥주 500cc', '주류', 8000, 'DONE', NULL, '', INTERVAL '2 minutes'),
  ('seed-order-02-1', 'seed-bill-02', '모둠 소시지', '안주', 22000, 'DONE', NULL, '', INTERVAL '0 minutes'),
  ('seed-order-02-2', 'seed-bill-02', '하이볼', '주류', 15000, 'DONE', NULL, '', INTERVAL '1 minute'),
  ('seed-order-02-3', 'seed-bill-02', '하이볼', '주류', 15000, 'DONE', NULL, '', INTERVAL '90 minutes'),
  ('seed-order-02-4', 'seed-bill-02', '콜라', '음료', 3000, 'DONE', NULL, '', INTERVAL '91 minutes'),
  ('seed-order-03-1', 'seed-bill-03', '위스키 샷', '주류', 18000, 'DONE', NULL, '', INTERVAL '0 minutes'),
  ('seed-order-03-2', 'seed-bill-03', '나초', '안주', 14000, 'DONE', NULL, '', INTERVAL '1 minute'),
  ('seed-order-04-1', 'seed-bill-04', '감바스 알 아히요', '안주', 25000, 'DONE', NULL, '', INTERVAL '0 minutes'),
  ('seed-order-04-2', 'seed-bill-04', '생맥주 500cc', '주류', 8000, 'DONE', NULL, '', INTERVAL '1 minute'),
  ('seed-order-04-3', 'seed-bill-04', '생맥주 500cc', '주류', 8000, 'DONE', NULL, '', INTERVAL '2 minutes'),
  ('seed-order-04-4', 'seed-bill-04', '감자튀김', '안주', 9000, 'DONE', NULL, '', INTERVAL '40 minutes'),
  ('seed-order-05-1', 'seed-bill-05', '하이볼', '주류', 15000, 'DONE', NULL, '', INTERVAL '0 minutes'),
  ('seed-order-05-2', 'seed-bill-05', '치즈 플래터', '안주', 27000, 'DONE', NULL, '', INTERVAL '1 minute'),
  ('seed-order-06-1', 'seed-bill-06', '하이볼', '주류', 15000, 'CANCELLED', NULL, '', INTERVAL '0 minutes'),
  ('seed-order-06-2', 'seed-bill-06', '나초', '안주', 14000, 'CANCELLED', NULL, '', INTERVAL '1 minute'),
  ('seed-order-07-1', 'seed-bill-07', '생맥주 500cc', '주류', 8000, 'ACKNOWLEDGED', NULL, '', INTERVAL '0 minutes'),
  ('seed-order-07-2', 'seed-bill-07', '감자튀김', '안주', 9000, 'READY', NULL, '케첩 많이', INTERVAL '5 minutes'),
  ('seed-order-08-1', 'seed-bill-08', '하이볼', '주류', 15000, 'DONE', NULL, '', INTERVAL '0 minutes'),
  ('seed-order-08-2', 'seed-bill-08', '모둠 소시지', '안주', 22000, 'DONE', NULL, '', INTERVAL '1 minute'),
  ('seed-order-09-1', 'seed-bill-09', '진토닉', '주류', 14000, 'DONE', NULL, '', INTERVAL '0 minutes'),
  ('seed-order-09-2', 'seed-bill-09', '과일 플래터', '안주', 30000, 'DONE', NULL, '', INTERVAL '1 minute'),
  ('seed-order-09-3', 'seed-bill-09', '카스 병맥주', '주류', 7000, 'DONE', '', '', INTERVAL '30 minutes')
) AS v(id, bill_id, menu_item_name, category_name, amount, status, table_number, request_note, ordered_after)
JOIN pos_bills b ON b.id = v.bill_id;

-- 계산서 도입 전 행(bill_id 없음, payment_method 'POS'). 통계는 메뉴 금액을
-- 쓰고 결제수단은 "POS(미확인)"으로 표시된다.
INSERT INTO payment_orders (
  id, menu_item_name, category_name, table_number, amount, status,
  payment_method, approved_at, vat, supplied_amount, tax_free_amount,
  pos_sync_status, pos_order_id, created_at, updated_at
)
SELECT id, menu_item_name, category_name, table_number, amount, 'DONE',
  'POS', approved_at, amount / 11, amount - amount / 11, 0,
  'SUCCEEDED', pos_order_id, created_at, approved_at
FROM (VALUES
  ('seed-legacy-1', '생맥주 500cc', '주류', 'T-06', 8000::bigint, 'seed-legacy-pos-01',
    pg_temp.seed_at(4, '19:00'), pg_temp.seed_at(4, '20:30')),
  ('seed-legacy-2', '감자튀김', '안주', 'T-06', 9000, 'seed-legacy-pos-01',
    pg_temp.seed_at(4, '19:01'), pg_temp.seed_at(4, '20:30')),
  ('seed-legacy-3', '하이볼', '주류', 'T-08', 15000, 'seed-legacy-pos-02',
    pg_temp.seed_at(2, '18:00'), pg_temp.seed_at(2, '19:20'))
) AS v(id, menu_item_name, category_name, table_number, amount, pos_order_id, created_at, approved_at);

-- 손님 웹 주문 행은 로컬 메뉴에 같은 이름이 있으면 menu_item_id를 연결한다(없으면
-- NULL 유지). POS 직접 입력 행(table_number '')은 실제처럼 NULL로 둔다.
UPDATE payment_orders o
SET menu_item_id = (SELECT m.id FROM menu_items m WHERE m.name = o.menu_item_name ORDER BY m.id LIMIT 1)
WHERE o.id LIKE 'seed-%' AND o.table_number <> '';

INSERT INTO payment_order_option_choices (
  order_id, option_id, option_choice_id, option_title, option_choice_title, price_value, quantity
) VALUES
  ('seed-order-01-1', 'seed-option-base', 'seed-choice-jimbeam', '베이스', '짐빔', 0, 1);
