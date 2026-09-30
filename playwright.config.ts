import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      TMDB_API_READ_ACCESS_TOKEN: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      RATE_LIMIT_SECRET: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      // Pin Google off so the "no Google button" check can't pick up a local value.
      GOOGLE_AUTH_ENABLED: "",
    },
  },
});
