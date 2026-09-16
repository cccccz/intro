import { defineConfig } from "@playwright/test";

/**
 * Optional window suite. Default `npm test` does not run this file.
 * `npm run test:ui` uses --project=electron (no visual).
 * Artifacts stay in gitignored directories.
 */
export default defineConfig({
  testDir: "app/electron/ui",
  outputDir: "test-results",
  snapshotPathTemplate: ".ui-baselines/{testFilePath}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "electron", testMatch: /smoke\.spec\.ts/ },
    { name: "visual", testMatch: /visual\.spec\.ts/ },
    { name: "explore", testMatch: /explore\.spec\.ts/ },
  ],
});
