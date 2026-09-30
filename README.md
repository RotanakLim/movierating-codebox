# CodeBox Movies

Next.js **15.5.26**, TypeScript, Tailwind CSS 4, and Supabase email/password + Google authentication. Includes movie discovery, posters, basic detail pages, and a secure movie-cache endpoint from `SPEC.md`. The remaining movie platform features are still in progress. Google OAuth is now in scope per the latest request.

## Run locally

Use Node.js 22 or newer (tested with Node 24) and npm.

```sh
npm install
cp .env.example .env.local
# Fill in the environment values described below.
npm run dev
```

Open http://localhost:3000. Without credentials, the landing page runs and auth forms show a disabled setup state. No sample credentials are used, and no Supabase project is automatically provisioned.

| Environment variable                   | Value                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL from the dashboard Connect dialog                        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's **publishable** key (a legacy anon key also works)              |
| `NEXT_PUBLIC_SITE_URL`                 | Exact canonical app origin, e.g. `http://localhost:3000`; HTTPS in production |

The public key is intentionally browser-safe when database RLS is properly configured. **Never use a secret/service-role key here.** The separate server-only `SUPABASE_SERVICE_ROLE_KEY` is used for movie caching and request-limit writes; `RATE_LIMIT_SECRET` keys the anonymised request-limit hashes. `.env.local` is ignored; `.env.example` contains blank key fields. Google secrets are configured in Supabase, not in frontend environment variables. Restart the dev server after changing environment values; rebuild deployments after changing public variables.

## Movie discovery setup

Add these **server-only** values to `.env.local` and your Vercel environment:

| Variable                     | Value                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `TMDB_API_READ_ACCESS_TOKEN` | TMDB API Read Access Token, not the shorter API key              |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase service-role key for the same project as the public URL |
| `RATE_LIMIT_SECRET`          | At least 32 random bytes: generate with `openssl rand -hex 32`   |

Never prefix any of these with `NEXT_PUBLIC_`. `RATE_LIMIT_SECRET` is only an HMAC key for request-limit counters: it must be at least 64 characters and must not reuse another key. Rotating it just resets current quotas. Apply all SQL migrations in timestamp order; see [DATABASE.md](DATABASE.md). Search requires TMDB plus Supabase configuration because request quotas are persisted in the database. Restart after configuring credentials. Missing configuration produces a recoverable setup message.

Visit `/discover` to search titles, filter by genre/year, and load more results. `/search` redirects there while preserving filters. Posters load directly from TMDB's CDN (`w342` in grids, `w500` on detail pages, no Next.js image optimization) and have a missing-image fallback. `/movies/[tmdbId]` shows basic details under a `<Title> (<Year>)` page title, plus the entry composer: a 0.0–10.0 score slider (mouse, touch, and keyboard: arrows ±0.1, Page Up/Down ±1, Home/End, Delete clears), plain-text review (5,000 characters), spoiler and watched toggles, and a watch date that defaults to today in the browser's timezone (past dates or "Date unknown"; no future dates). "Rate or review" edits the current rated entry, else the newest entry, else creates one; "Log another watch" always creates a new entry. Saves go through the `saveEntry` server action (zod, `getUser()`, verified email and username, `cacheMovie()` when needed, session client + RLS) with a client UUID so retries can't duplicate, and a version check that reports edits made elsewhere. Unsent drafts stay in session storage per user and movie, survive a guest's sign-in, and are cleared on save and sign-out, and `/about` includes TMDB attribution.

`GET /api/movies/search` calls TMDB on the server. Search results are cached for five minutes; detail responses for 24 hours. For title searches, genre filtering applies to each fetched TMDB page, so a filtered page can be empty while more pages remain. Browse-only genre filtering is handled upstream.

`POST /api/movies/cache` accepts only `{ "tmdbId": 693134 }` and `cacheMovie()` upserts a movie into `movies`. No UI calls them yet; the upcoming rating and watchlist actions will, because entries and list items reference `movies`. A verified signed-in user is required. The server fetches authoritative metadata and upserts only `tmdb_id`, `title`, `poster`, `year`, and `cached_at`; repeated calls are safe. Use the exact `NEXT_PUBLIC_SITE_URL` browser origin so the mutation origin check succeeds.

`/api/movies/search` is limited to 60 requests/minute per trusted Vercel client IP. Outside Vercel it uses a deployment-wide bucket until a trusted proxy integration is supplied. Movie detail pages are not rate-limited: they render from TMDB details cached for 24 hours, so a page view never writes to the database. The cache endpoint allows 30 requests/10 minutes per verified user. Database keys are HMAC hashes; quota rows older than a day are cleaned up on about 1% of requests. If the quota database is unavailable, requests fail with a retryable error. Detail pages can fall back to minimal cached metadata on service failures, but never on a TMDB not-found/adult exclusion response.

Tests use mocked TMDB/Supabase responses and an isolated PostgreSQL engine; they do not validate live credentials. After setup, search for a movie and open its detail page to confirm TMDB and the quota database are reachable.

References: [TMDB application authentication](https://developer.themoviedb.org/docs/authentication-application), [movie search](https://developer.themoviedb.org/reference/search-movie), [poster images](https://developer.themoviedb.org/docs/image-basics).

## Supabase setup

1. Create or select your Supabase project and copy the URL and publishable key to `.env.local`.
2. Enable Email under Authentication → Providers. Keep **Confirm email** enabled, and set the minimum password length to 12 to match application validation.
3. Under URL Configuration, set Site URL to the canonical origin and allow these development redirects:
   - `http://localhost:3000/auth/callback**`
   - `http://localhost:3000/auth/confirm**`
   - Add the corresponding HTTPS URLs for your actual deployment. These patterns cover the app's `next` query string. Use explicit trusted origins; do not allow arbitrary hosts. Visiting a different hostname/port than `NEXT_PUBLIC_SITE_URL` can break the PKCE cookie exchange.
4. Configure custom SMTP for public email signup, confirmation, and reset delivery. Supabase's default mail service is restricted to project-team addresses and is insufficient for public signup. See [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp).
5. Set the following email templates under Authentication → Email Templates. The application supplies `RedirectTo` pointing at `/auth/confirm` with a safe `next` value. Keep these templates synchronized with that route.

**Confirm signup:**

```html
<h2>Confirm your CodeBox Movies account</h2>
<p>
  <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email"
    >Confirm email</a
  >
</p>
```

**Reset password:**

```html
<h2>Reset your CodeBox Movies password</h2>
<p>
  <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery"
    >Choose a new password</a
  >
</p>
```

### Apply migrations to my hosted project

Run these yourself; nothing in this repository connects to your hosted project. The Supabase CLI is not a project dependency; `npx supabase` downloads it on first use.

1. `npx supabase login` (opens a browser to create an access token).
2. `npx supabase link --project-ref <your-project-ref>` — the ref is the subdomain in your project URL (`https://<project-ref>.supabase.co`). You will be asked for the database password.
3. `npx supabase db push --dry-run` — lists the migrations that would run. Check that only the new, expected files appear.
4. `npx supabase db push` — applies them in timestamp order and records them in the project's migration history.
5. In the dashboard, open **Project Settings → Data API** and confirm **Exposed schemas** lists `public` (and `graphql_public`) but **not** `codebox_private`. That schema holds internal helper functions and rate-limit counters and must never be reachable through the API.
6. Open **Advisors → Security Advisor** and review every finding. `user_identities`, `public_reviews` and `public_current_ratings` are intentionally narrow definer views (see [DATABASE.md](DATABASE.md)); anything else is a real issue to fix.
7. Confirm the signup trigger works: sign up a test account, then in **Table Editor** open `users` and check a row exists whose `id` matches the new user in **Authentication → Users**, and open `lists` and check that user has exactly one row with `kind = watchlist` and `name = Watchlist`. Both rows are created by the `handle_auth_signup` / `create_watchlist` triggers; if either is missing, the migrations did not apply correctly.

### Local database and generated types

`npx supabase start` (or `npx supabase db start` for Postgres only) runs a local stack in Docker and applies every migration. After changing a migration, run `npm run db:types` to regenerate `src/lib/supabase/database.types.ts`, which types the server, browser and service-role clients. `supabase/config.toml` is local-only configuration and contains no secrets.

The token-hash confirmation route allows email links to work across browsers. Recovery always sends the verified user to `/auth/update-password`; query parameters cannot override it. Supabase manages `auth.users`. The core application tables now have SQL migrations; see [DATABASE.md](DATABASE.md) for application, privacy rules, and integration examples. Client-side route hiding is not data authorization.

## Google setup

1. In Google Cloud / Google Auth Platform, configure the consent screen, audience, and test users if the app is in testing mode. Request only basic OpenID/email/profile access.
2. Create an OAuth client of type **Web application**.
3. Add the app's development and deployed origins under Authorized JavaScript origins.
4. Add the **Supabase** callback URL shown in the Supabase Google provider panel to Google's Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`. This is different from your app's `/auth/callback` route.
5. Enable Google in Supabase Authentication → Providers and enter the Google Client ID and Client Secret **there**.
6. Ensure the app's `/auth/callback` URLs are in Supabase's redirect allowlist (previous section).

The flow is app → Supabase → Google → Supabase → app `/auth/callback`. The app exchanges the PKCE authorization code for a cookie-based session. Canceled, missing, or expired codes produce a recoverable error page. See [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Implemented routes

- `/`: responsive landing page, system-aware light/dark theme with local preference.
- `/auth/sign-in`: email/password and Google sign-in.
- `/auth/sign-up`: email signup with password confirmation and Google signup.
- `/auth/verify`: resend email confirmation.
- `/auth/forgot-password`: generic password-reset request response.
- `/auth/confirm`: verification/recovery token exchange; uses the templates above.
- `/auth/callback`: Google PKCE code exchange.
- `/auth/update-password`: authenticated, verified-user password form (also usable by Google users to set a password).
- `/auth/error`: expired/canceled/failed auth recovery links.
- `/account`: server-protected account page and current-browser sign-out.
- `/onboarding`: required username (3–24 lowercase letters, digits, underscores; reserved names rejected; permanent in v1) with a debounced availability check, then optional favorite genres and up to five favorite movies (skippable), then a notice that profiles are public by default. Sign-in, Google callback, and email confirmation send accounts without a username here first, preserving the safe `next` path. The header shows `Finish setup` until a username exists, then a link to `/u/<username>`.
- `GET /api/me`: the signed-in user's username for that header link (private, no-store; display only, never used for authorization). The header only calls it when a Supabase session cookie exists, so guests make no request and public pages stay static.

`src/lib/supabase/client.ts` supplies the browser client for future interactive data features; `server.ts` supplies a request-scoped cookie client. `src/middleware.ts` refreshes sessions with `getClaims()` and forwards updated cookies; this is **middleware.ts**, not Next.js 16's proxy.ts. It skips `/api/movies/search`, and only marks a response `private, no-store` when it refreshes auth cookies or the path is under `/auth` or `/account`, so public pages stay cacheable. `getClaims()` verifies the JWT locally when the project uses asymmetric JWT signing keys (otherwise it calls Auth), but cannot see sessions revoked since the token was issued, so protected pages and server actions independently verify identity via `getUser()`, never `getSession()`. Pages that call `getUser()` always render dynamically; `/about` and `/discover` are static. Callback redirects use the configured canonical origin and reject external `next` values. Auth responses are private/no-store and auth pages are noindex. Account information is not exposed to guests.

Passwords and provider error payloads are not logged. Supabase handles password storage and auth rate limits; configure its abuse controls before public launch. Theme account synchronization, profile pages (`/u/[username]`), settings, reviews, and the rest of `SPEC.md` remain future work.

PostCSS is overridden to a patched 8.x release because Next.js 15 pins an older transitive version; retain this override until the framework dependency is patched.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run test:db
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit tests cover redirect abuse, session refresh cookies, server-action validation, failed/successful OAuth exchanges, token verification, and unauthenticated password updates with mocked Supabase responses. Browser smoke tests run in an explicitly **unconfigured** environment to verify setup UI, protected-route redirects, mobile layout, and theme persistence. They never use real credentials or send email.

After setting up your real project, manually verify: signup → email confirmation → account; bad password; resend; password reset → change password → fresh login; Google success/cancel; refresh while signed in; sign-out → protected redirect. Test a non-team email to confirm SMTP readiness. Automated mocks cannot establish that a real Google client, SMTP service, or Supabase redirect configuration is correct.

## Deploy to Vercel

Import this repository as a Next.js project. Add all six environment values, set the canonical HTTPS origin, and update Supabase and Google origins/redirects. Build with `npm run build`. Do not deploy this repo with `.env.local` committed. Do not add service-role keys to browser variables. Auth secrets and test accounts are not bundled in the repository.

Official references: [Next.js 15 installation](https://nextjs.org/docs/15/app/getting-started/installation), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [email/password authentication](https://supabase.com/docs/guides/auth/passwords).
