import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AccessRequiredPage() {
  const testEntryEnabled = Boolean(process.env.CUSTOMER_TEST_ENTRY_TOKEN);
  const tableOptions = [
    ...Array.from({ length: 12 }, (_, index) => `T-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 5 }, (_, index) => `B-${String(index + 1).padStart(2, "0")}`),
  ];

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
                <select name="table" defaultValue="T-01">
                  {tableOptions.map((table) => (
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
