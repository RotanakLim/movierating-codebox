# CodeBox Movies

Next.js **15.5.26**, TypeScript, Tailwind CSS 4, and Supabase email/password + Google authentication. Includes movie discovery, posters, basic detail pages, and secure selection caching from `SPEC.md`. The remaining movie platform features are still in progress. Google OAuth is now in scope per the latest request.

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

The public key is intentionally browser-safe when database RLS is properly configured. **Never use a secret/service-role key here.** The separate server-only `SUPABASE_SERVICE_ROLE_KEY` is used for movie caching and request limits. `.env.local` is ignored; `.env.example` contains blank key fields. Google secrets are configured in Supabase, not in frontend environment variables. Restart the dev server after changing environment values; rebuild deployments after changing public variables.

## Movie discovery setup

Add these **server-only** values to `.env.local` and your Vercel environment:

| Variable                     | Value                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `TMDB_API_READ_ACCESS_TOKEN` | TMDB API Read Access Token, not the shorter API key              |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase service-role key for the same project as the public URL |

Never prefix either with `NEXT_PUBLIC_`. Apply all three SQL migrations in timestamp order; see [DATABASE.md](DATABASE.md). Search requires TMDB plus Supabase configuration because request quotas are persisted in the database. Restart after configuring credentials. Missing configuration produces a recoverable setup message.

Visit `/discover` to search titles, filter by genre/year, and load more results. `/search` redirects there while preserving filters. Posters have a missing-image fallback. `/movies/[tmdbId]` shows basic details, and `/about` includes TMDB attribution.

`GET /api/movies/search` calls TMDB on the server. Search results are cached for five minutes; detail responses for 24 hours. For title searches, genre filtering applies to each fetched TMDB page, so a filtered page can be empty while more pages remain. Browse-only genre filtering is handled upstream.

Selecting a movie posts only `{ "tmdbId": 693134 }` to `/api/movies/cache`. A verified signed-in user is required. The server fetches authoritative metadata and upserts only `tmdb_id`, `title`, `poster`, `year`, and `cached_at`; repeated selection is safe. This does not create a rating or watchlist entry. Guests can browse and view details, then sign in and select again. Use the exact `NEXT_PUBLIC_SITE_URL` browser origin so the mutation origin check succeeds.

Search and detail reads share a limit of 60 requests/minute per trusted Vercel client IP. Outside Vercel they share a deployment-wide bucket until a trusted proxy integration is supplied. Selection allows 30 requests/10 minutes per verified user. Database keys are HMAC hashes; expired quota rows are cleaned up after a day during requests. If the quota database is unavailable, requests fail with a retryable error. Detail pages can fall back to minimal cached metadata on service failures, but never on a TMDB not-found/adult exclusion response.

Tests use mocked TMDB/Supabase responses and an isolated PostgreSQL engine; they do not validate live credentials. After setup, search for a movie, select it while signed in, and inspect its minimal `movies` row in Supabase.

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

`src/lib/supabase/client.ts` supplies the browser client for future interactive data features; `server.ts` supplies a request-scoped cookie client. `src/middleware.ts` refreshes sessions and forwards updated cookies; this is **middleware.ts**, not Next.js 16's proxy.ts. Protected pages/actions independently verify identity via `getUser()`, not `getSession()`. Callback redirects use the configured canonical origin and reject external `next` values. Auth responses are private/no-store and auth pages are noindex. Account information is not exposed to guests.

Passwords and provider error payloads are not logged. Supabase handles password storage and auth rate limits; configure its abuse controls before public launch. Theme account synchronization, username onboarding, reviews, and the rest of `SPEC.md` remain future work.

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

Import this repository as a Next.js project. Add all five environment values, set the canonical HTTPS origin, and update Supabase and Google origins/redirects. Build with `npm run build`. Do not deploy this repo with `.env.local` committed. Do not add service-role keys to browser variables. Auth secrets and test accounts are not bundled in the repository.

Official references: [Next.js 15 installation](https://nextjs.org/docs/15/app/getting-started/installation), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [email/password authentication](https://supabase.com/docs/guides/auth/passwords).
