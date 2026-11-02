import { defineConfig, devices } from "@playwright/test";

/** The demo build's own E2E (docs/DEPLOYMENT-demo.md). Build first with NEXT_PUBLIC_DEMO_MODE=1; there is no backend. */
const baseURL = "http://localhost:3334";

export default defineConfig({
  testDir: "./e2e/demo",
  fullyParallel: true,
  workers: Number(process.env.PW_WORKERS) || 2,
  retries: 0,
  use: { baseURL, locale: "zh-CN", trace: "off", screenshot: "only-on-failure", actionTimeout: 8000 },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /narrow/ },
    { name: "narrow", use: { ...devices["Pixel 5"] }, testMatch: /narrow/ },
  ],
  webServer: {
    command: "npx next start -p 3334",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_DEMO_MODE: "1" },
  },
});
