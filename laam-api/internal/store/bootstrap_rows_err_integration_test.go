package store

import (
	"context"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRepository_GetBootstrapData_ReturnsRowsIterationError는 결과 행을 읽는
// 도중 서버가 오류를 보내면 GetBootstrapData가 일부만 담긴 데이터를 정상
// 응답으로 돌려주지 않고 오류를 반환하는지 확인한다.
//
// 각 대상 테이블과 같은 이름의 view를 별도 schema에 만들고 search_path 앞에
// 두면, 해당 조회만 실행 도중(sort_order가 2 이상인 행) 0으로 나누기 오류가 난다.
// 이 오류는 Query 호출이 아니라 rows 반복 이후 rows.Err()로만 드러난다.
func TestRepository_GetBootstrapData_ReturnsRowsIterationError(t *testing.T) {
	tables := []string{"menu_categories", "menu_items", "menu_item_images", "request_guides", "notices"}

	for _, table := range tables {
		t.Run(table, func(t *testing.T) {
			resetDB(t)
			ctx := context.Background()
			seedBootstrapRowsForIterationError(t, ctx)

			schema := "bootstrap_rows_err_" + table
			if _, err := testPool.Exec(ctx, fmt.Sprintf(`DROP SCHEMA IF EXISTS %s CASCADE`, schema)); err != nil {
				t.Fatalf("drop schema: %v", err)
			}
			if _, err := testPool.Exec(ctx, fmt.Sprintf(`CREATE SCHEMA %s`, schema)); err != nil {
				t.Fatalf("create schema: %v", err)
			}
			t.Cleanup(func() {
				_, _ = testPool.Exec(context.Background(), fmt.Sprintf(`DROP SCHEMA IF EXISTS %s CASCADE`, schema))
			})
			if _, err := testPool.Exec(ctx, fmt.Sprintf(
				`CREATE VIEW %s.%s AS SELECT * FROM public.%s WHERE 1 / (CASE WHEN sort_order >= 2 THEN 0 ELSE 1 END) = 1`,
				schema, table, table,
			)); err != nil {
				t.Fatalf("create failing view: %v", err)
			}

			config := testPool.Config().Copy()
			config.ConnConfig.RuntimeParams["search_path"] = pgx.Identifier{schema}.Sanitize() + ", public"
			pool, err := pgxpool.NewWithConfig(ctx, config)
			if err != nil {
				t.Fatalf("open pool: %v", err)
			}
			t.Cleanup(pool.Close)

			if _, err := New(pool).GetBootstrapData(ctx); err == nil {
				t.Fatalf("GetBootstrapData() error = nil, want rows iteration error from %s", table)
			}
		})
	}
}

func seedBootstrapRowsForIterationError(t *testing.T, ctx context.Context) {
	t.Helper()
	statements := []string{
		`INSERT INTO menu_categories (id, label, sort_order) VALUES ('c1', 'Cat 1', 1), ('c2', 'Cat 2', 2)`,
		`INSERT INTO menu_items (id, category_id, name, description, price, sort_order) VALUES
			('m1', 'c1', 'Item 1', 'desc', '1000', 1), ('m2', 'c1', 'Item 2', 'desc', '2000', 2)`,
		`INSERT INTO menu_item_images (id, menu_item_id, filename, mime_type, content, size_bytes, sort_order) VALUES
			('i1', 'm1', 'a.png', 'image/png', '\x00', 1, 1), ('i2', 'm1', 'b.png', 'image/png', '\x00', 1, 2)`,
		`INSERT INTO request_guides (id, text, sort_order) VALUES ('r1', 'guide 1', 1), ('r2', 'guide 2', 2)`,
		`INSERT INTO notices (id, text, sort_order) VALUES ('n1', 'notice 1', 1), ('n2', 'notice 2', 2)`,
	}
	for _, statement := range statements {
		if _, err := testPool.Exec(ctx, statement); err != nil {
			t.Fatalf("seed bootstrap rows: %v", err)
		}
	}
}
