import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
    locale: "ko-KR",
  },
  webServer: {
    command: "npm run build && npm run start -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    env: {
      // Only the admin-login/-logout routes actually run for real in this
      // suite (they never call `laam-api`); every route that would call
      // `laam-api` (bootstrap, `/api/admin/*`) is intercepted with
      // `page.route(...)` per `tests/e2e/fixtures.ts`, so `API_BASE_URL`
      // below is deliberately unreachable — a test with a gap in its mocks
      // fails loudly (connection refused) instead of hitting a real host.
      SESSION_SECRET: "e2e-session-secret",
      ADMIN_PASSWORD: "test-admin-password",
      ADMIN_API_TOKEN: "e2e-admin-api-token",
      API_BASE_URL: "http://127.0.0.1:9",
    },
  },
});
