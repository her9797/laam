import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: "./test/setup.ts",
    exclude: ["tests/e2e/**", "node_modules/**"],
    env: {
      SESSION_SECRET: "test-session-secret",
      ADMIN_PASSWORD: "test-admin-password",
      ADMIN_API_TOKEN: "test-admin-api-token",
      API_BASE_URL: "http://127.0.0.1:9999",
    },
  },
});
