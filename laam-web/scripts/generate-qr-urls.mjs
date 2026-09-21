// 테이블별 QR 입장 주소를 출력한다.
//
// 테이블 목록은 POS에서 오고 코드는 관리자가 정하므로 여기에 고정해 두면
// 금방 실제와 어긋난다. 그래서 기본값은 laam-api의 관리자 목록을 읽는 것이고,
// 서버를 쓸 수 없을 때만 QR_TABLES로 직접 넘긴다.
//
//   QR_SIGNING_SECRET=... ADMIN_API_TOKEN=... API_BASE_URL=http://localhost:9090 npm run qr:urls
//   QR_SIGNING_SECRET=... QR_TABLES=T-01,T-02,R-01 npm run qr:urls
//
// 관리자 화면의 QR 화면에서 ZIP으로 내려받는 것이 더 쉬운 길이다. 이 스크립트는
// 서버 쪽에서 주소만 빠르게 확인할 때 쓴다.

import { createHmac } from "node:crypto";

const secret = process.env.QR_SIGNING_SECRET;
const baseUrl = (process.env.QR_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:9090").replace(/\/$/, "");
const adminToken = process.env.ADMIN_API_TOKEN;

/** QR_TABLES로 직접 넘긴 코드 목록. 형식이 맞는 것만 남긴다. */
function tablesFromEnv() {
  const raw = process.env.QR_TABLES;
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z]-\d{2}$/.test(value));
}

/** laam-api의 관리자 테이블 목록에서 코드를 읽는다. */
async function tablesFromApi() {
  if (!adminToken) {
    throw new Error(
      "ADMIN_API_TOKEN이 필요하다. 서버를 쓸 수 없으면 QR_TABLES=T-01,T-02 처럼 직접 넘긴다.",
    );
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/admin/tables`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!response.ok) {
    throw new Error(`테이블 목록을 읽지 못했다: HTTP ${response.status}`);
  }

  const body = await response.json();
  const tables = Array.isArray(body?.tables) ? body.tables : [];
  return tables.map((table) => table.id).filter((id) => typeof id === "string" && id);
}

if (!secret) {
  console.error("QR_SIGNING_SECRET is required.");
  process.exitCode = 1;
} else {
  try {
    const fromEnv = tablesFromEnv();
    const tables = fromEnv.length > 0 ? fromEnv : await tablesFromApi();
    if (tables.length === 0) {
      console.error("테이블이 없다. 관리자 화면에서 POS 테이블을 먼저 가져온다.");
      process.exitCode = 1;
    }

    for (const table of tables) {
      const signature = createHmac("sha256", secret).update(table).digest("hex");
      console.log(`${baseUrl}/qr/enter?table=${table}&sig=${signature}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
