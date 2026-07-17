import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4178",
    ...(process.env.CI ? {} : { channel: "chrome" }),
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1366, height: 900 } }
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    }
  ]
});
