import { defineConfig, devices } from "@playwright/test";

// Browser journeys against a real local Supabase stack. Run them with
// `npm run test:e2e:stack`, which reads the stack's URL and keys from
// `supabase status`, builds the app against them and then starts this config.
// Never point it at a hosted project: global setup creates and deletes
// e2e_* accounts.
const port = Number(process.env.E2E_PORT ?? 3200);
export default defineConfig({
  testDir: "./tests/e2e-stack",
  globalSetup: "./tests/e2e-stack/global-setup.ts",
  // Journeys share seeded accounts, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    // Optional: a preinstalled Chromium when Playwright's own download is unavailable.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}/about`,
    // A server left on the port may be built with other keys; reuse it only
    // when asked (E2E_REUSE_SERVER=1, e.g. while iterating on one spec).
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 120_000,
  },
});
