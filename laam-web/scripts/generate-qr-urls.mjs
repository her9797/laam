import { createHmac } from "node:crypto";

const secret = process.env.QR_SIGNING_SECRET;
const baseUrl = (process.env.QR_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!secret) {
  console.error("QR_SIGNING_SECRET is required.");
  process.exitCode = 1;
} else {
  const tables = [
    ...Array.from({ length: 12 }, (_, index) => `T-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 5 }, (_, index) => `B-${String(index + 1).padStart(2, "0")}`),
  ];

  for (const table of tables) {
    const signature = createHmac("sha256", secret).update(table).digest("hex");
    console.log(`${baseUrl}/qr/enter?table=${table}&sig=${signature}`);
  }
}
