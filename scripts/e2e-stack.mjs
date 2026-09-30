// Runs the stack-backed browser journeys (tests/e2e-stack) against the local
// Supabase started with `npx supabase start`. Reads its URL and keys from
// `supabase status`, builds the app with them (NEXT_PUBLIC_* values are baked
// in at build time) and runs Playwright. TMDB is left unconfigured on purpose:
// movie pages use the local movie cache, which is what the journeys seed.
//   npm run test:e2e:stack [-- <playwright args>]
// Set E2E_SKIP_BUILD=1 to reuse the last build.
import { execFileSync, spawnSync } from "node:child_process";

const port = process.env.E2E_PORT ?? "3200";
let status;
try {
  status = JSON.parse(
    execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
} catch {
  console.error(
    "The local Supabase stack isn't running. Start it with `npx supabase start`.",
  );
  process.exit(1);
}
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SECRET_KEY,
  NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
  RATE_LIMIT_SECRET: "e2e-local-rate-limit-secret-0123456789abcdef",
  CRON_SECRET: "e2e-local-cron-secret-0123456789abcdef",
  TMDB_API_READ_ACCESS_TOKEN: "",
  E2E_PORT: port,
  E2E_DB_URL: status.DB_URL,
};
const run = (command, args) => {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (process.env.E2E_SKIP_BUILD !== "1") run("npx", ["next", "build"]);
run("npx", [
  "playwright",
  "test",
  "-c",
  "playwright.stack.config.ts",
  ...process.argv.slice(2),
]);
