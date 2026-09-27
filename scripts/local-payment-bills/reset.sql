-- 로컬 계산서 테스트 데이터 제거.
--
-- seed.sql이 넣은 행(id가 'seed-'로 시작)만 지운다. 실제 주문·계산서·결제는
-- 건드리지 않는다. 직접 실행하지 말고 seed.sh reset을 쓴다(로컬 DB 안전장치와
-- 트랜잭션을 seed.sh가 붙인다).
--
-- payment_order_option_choices는 payment_orders 삭제 시 CASCADE로,
-- pos_payments는 pos_bills 삭제 시 CASCADE로 함께 지워진다.

DELETE FROM payment_orders WHERE id LIKE 'seed-%';
DELETE FROM pos_payments WHERE id LIKE 'seed-%';
DELETE FROM pos_bills WHERE id LIKE 'seed-%';
