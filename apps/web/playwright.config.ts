import { defineConfig, devices } from "@playwright/test";
import { API_PORT, BASE_URL, WEB_PORT, e2eEnv } from "./e2e/e2e-env.mjs";

// Run `npm run test:e2e -w apps/web` (prepares a dedicated database and builds first).
const env = e2eEnv() as Record<string, string>;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  // The suite shares one seeded organization and changes it, so tests run in order on one worker.
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Locally, use the installed Chrome (no browser download); CI installs Playwright's Chromium.
    ...devices["Desktop Chrome"],
    channel: ci ? undefined : "chrome",
  },
  webServer: [
    { name: "api", command: "node ../../services/api/dist/main.js", url: `http://127.0.0.1:${API_PORT}/api/v1/ready`, env, reuseExistingServer: !ci, timeout: 120_000 },
    { name: "worker", command: "node ../../services/api/dist/worker.js", env: { ...env, WORKER_ENABLED: "true" }, wait: { stdout: /Worker started/ }, reuseExistingServer: !ci, timeout: 120_000 },
    { name: "web", command: `npx next start -p ${WEB_PORT}`, url: `${BASE_URL}/login`, env, reuseExistingServer: !ci, timeout: 120_000 },
  ],
});
