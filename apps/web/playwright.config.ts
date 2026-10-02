import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: process.env.APP_ORIGIN || "http://localhost:18130",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: "../../artifacts/playwright-report", open: "never" },
    ],
  ],
  outputDir: "../../artifacts/playwright-results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
