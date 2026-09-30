import Link from "next/link";

import {
  CUSTOMER_TEST_TABLE_OPTIONS,
  DEFAULT_CUSTOMER_TEST_TABLE,
} from "@/lib/customer-test-entry";

export const dynamic = "force-dynamic";

export default function AccessRequiredPage() {
  const testEntryEnabled = Boolean(process.env.CUSTOMER_TEST_ENTRY_TOKEN);

  return (
    <main className="page-shell">
      <div className="phone-frame">
        <section className="content-card">
          <div className="section-header">
            <div>
              <p className="section-kicker">qr only</p>
              <h2>QR로 접속해주세요</h2>
            </div>
          </div>
          <p className="notice-item" style={{ paddingTop: 0 }}>
            이 메뉴는 매장 QR 스캔을 통해서만 입장할 수 있습니다.
          </p>
          <Link className="primary-pill" href="/">
            다시 시도
          </Link>
          {testEntryEnabled ? (
            <form action="/test/enter" method="post" style={{ display: "grid", gap: 12, marginTop: 24 }}>
              <p className="section-kicker">test access</p>
              <label className="request-compose-field">
                <span>테스트 입장 토큰</span>
                <input name="key" type="password" autoComplete="off" required />
              </label>
              <label className="request-compose-field">
                <span>테이블</span>
                <select name="table" defaultValue={DEFAULT_CUSTOMER_TEST_TABLE}>
                  {CUSTOMER_TEST_TABLE_OPTIONS.map((table) => (
                    <option key={table} value={table}>
                      {table}
                    </option>
                  ))}
                </select>
              </label>
              <button className="request-compose-button" type="submit">
                테스트 환경 입장
              </button>
            </form>
          ) : null}
        </section>
      </div>
    </main>
  );
}
