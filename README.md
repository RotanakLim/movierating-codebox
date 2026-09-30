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

The public key is intentionally browser-safe when database RLS is properly configured. **Never use a secret/service-role key here.** The separate server-only `SUPABASE_SERVICE_ROLE_KEY` is used for movie caching, request-limit writes and account-deletion cleanup; `CRON_SECRET` authorizes the scheduled cleanup retry; `RATE_LIMIT_SECRET` keys the anonymised request-limit hashes. `.env.local` is ignored; `.env.example` contains blank key fields. Google secrets are configured in Supabase, not in frontend environment variables. Restart the dev server after changing environment values; rebuild deployments after changing public variables.

## Movie discovery setup

Add these **server-only** values to `.env.local` and your Vercel environment:

| Variable                     | Value                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `TMDB_API_READ_ACCESS_TOKEN` | TMDB API Read Access Token, not the shorter API key              |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase service-role key for the same project as the public URL |
| `RATE_LIMIT_SECRET`          | At least 32 random bytes: generate with `openssl rand -hex 32`   |
| `CRON_SECRET`                | At least 32 random characters (`openssl rand -hex 32`)           |

Never prefix any of these with `NEXT_PUBLIC_`. `RATE_LIMIT_SECRET` is only an HMAC key for request-limit counters: it must be at least 64 characters and must not reuse another key. Rotating it just resets current quotas. Apply all SQL migrations in timestamp order; see [DATABASE.md](DATABASE.md). Search requires TMDB plus Supabase configuration because request quotas are persisted in the database. Restart after configuring credentials. Missing configuration produces a recoverable setup message.

Visit `/discover` to search titles, filter by genre/year, and load more results. `/search` redirects there while preserving filters. Posters load directly from TMDB's CDN (`w342` in grids, `w500` on detail pages, no Next.js image optimization) and have a missing-image fallback. `/movies/[tmdbId]` shows basic details under a `<Title> (<Year>)` page title, plus the entry composer: a 0.0–10.0 score slider (mouse, touch, and keyboard: arrows ±0.1, Page Up/Down ±1, Home/End, Delete clears), plain-text review (5,000 characters), spoiler and watched toggles, and a watch date that defaults to today in the browser's timezone (past dates or "Date unknown"; no future dates). "Rate or review" edits the current rated entry, else the newest entry, else creates one; "Log another watch" always creates a new entry. Saves go through the `saveEntry` server action (zod, `getUser()`, verified email and username, `cacheMovie()` when needed, session client + RLS) with a client UUID so retries can't duplicate, and a version check that reports edits made elsewhere. Unsent drafts stay in session storage per user and movie, survive a guest's sign-in, and are cleared on save and sign-out, and `/about` includes TMDB attribution.

`/movies/[tmdbId]` also shows the CodeBox community average (0.0–10.0, one decimal, with the rater count, or "Not rated yet") beside a separately labelled TMDB score; the two are never blended. Principal cast, a trailer link (opened only by clicking; never embedded or autoplayed) and the earliest known release date come from one TMDB request (`append_to_response=credits,videos,release_dates`) cached for 24 hours. Unreleased movies can be added to the watchlist, but ratings, reviews and watch logs open on the earliest known release date in the viewer's timezone; an unknown date never blocks them. The watchlist toggle updates optimistically and rolls back if the server refuses. Reviews list newest first with a "Written reviews only" filter and 20 per page; spoiler reviews stay hidden behind a reveal button and never appear in page metadata. `GET /api/movies/[tmdbId]/reviews?cursor=…&written=1` serves further pages (private, no-store, because blocks are viewer-specific).

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

- `/`: the landing page for guests and for accounts that haven't finished onboarding. Signed-in users get their home feed:
  - Tabs: **Following** (ratings, reviews and watches from people you follow; watched-only entries only when their profile allows it) and **Community** (public ratings and reviews from everyone).
  - Following is the default once you follow someone. Until then you see Community plus a "Find people" prompt.
  - Cards show who rated, reviewed or watched which movie, the score, and the date. They never show review text or spoiler content; reviews link to the movie page, where spoilers stay behind a reveal.
  - Pages load newest first by `(created_at, id)` through `GET /api/feed?tab=&cursor=` (private, no-store).
  - Every card is a real row read under RLS, so blocked, hidden, suspended and inaccessible activity is left out. An empty feed says so; nothing is invented.
- `/people`: username search (prefix, any privacy mode, since usernames and avatars are public) and, with no search, public profiles ordered by recent public activity. Blocked and suspended accounts are left out, and display names appear only when the viewer may see the profile. Signed-in users get Follow / Request to follow / Cancel request / Unfollow buttons; guests can search.
- `/notifications`:
  - Follow requests, with Accept and Decline.
  - New followers from the last 30 days, with Follow back and Remove.
  - Requests you sent, with Cancel.

  The nav badge counts pending requests. The full notification inbox (comments, replies, unread state) isn't built yet.

- Theme: the theme follows the system until you pick light or dark; the choice is stored in this browser (read by an inline script before first paint, so there's no flash) and, once signed in, in your account.
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
- Left navigation (Home, Discover, My Movies, Watchlist, Notifications, Profile, Settings) on large screens; a top bar with an accessible menu on phones, with no horizontal scroll at 360px. The Profile link comes from `/api/me`, so the layout stays static.
- `/me/movies`: the owner's collection, one row per movie with the current score, last known watch date and watch count.
  - Sort by highest or lowest rated, title, or latest watch. Unrated movies and unknown dates sort last, with ties broken by title and then movie ID. There is no manual ordering.
  - Filter to rated and/or watched movies.
- `/me/diary`: watched entries grouped by date, plus an "Unknown date" group. Each row has Edit (opens the movie page composer via `?edit=`) and Delete with an inline confirmation.
- `/me/watchlist`: the owner's watchlist with remove. Movies are added from movie pages.
- `/me/lists`: create, rename and delete custom lists and remove movies from them. Movies are added from a movie page's "Add to list".
- `/u/[username]`: the same tabs (Movies, Diary, Watchlist, Lists) for anyone the profile's privacy setting allows.
  - Everyone else sees a restricted shell: username, avatar, a restriction message, and follow/request, block and report controls.
  - Block explains that follows are removed and that public content stays visible to signed-out visitors.
  - Reports return a receipt and are never readable by clients.
- `/reviews/[id]`: a public review page for any rating or review the viewer may see. Movie-page review cards and feed cards link here.
  - The page shows the score, the review (spoilers stay behind a reveal), and a like count from the database. Metadata uses only the username, movie and score, never review text.
  - **Likes:** one per user, reversible, and never on your own review. The count changes at once and settles on the database's answer, or rolls back with a message if refused.
  - **Discussion:** threads oldest first, 20 per page, each with its first 3 replies and "Show more replies" (keyset pagination by `(created_at, id)` via `GET /api/reviews/[id]/comments` and `…/comments/replies?thread=`).
    - Only one reply level: replying to a reply posts in the same thread with "replying to @user".
    - Comments are plain text up to 2,000 characters, each with its own spoiler flag.
    - Owners can edit (shown as "edited") or delete. A deleted comment that still has replies shows "[deleted]"; comments hidden by moderators show "[removed by a moderator]".
    - Others can report a comment or reply.
  - **Owner:** "Edit review" opens the movie-page composer. "Delete review" confirms with the number of likes and comments that go with it.
  - **Others:** Report, and Block (which leaves the page).
  - Guests can read everything and get sign-in links for liking and commenting.
- Review cards on movie pages, for signed-in viewers other than the author:
  - **Report** takes a reason, optional details (up to 1,000 characters) and gives a receipt.
  - **Block @user** shows the same disclosure as profiles. The author's reviews then disappear from the list, with an **Unblock** undo.
- `/admin/reports` (admins only; everyone else gets a 404):
  - The queue shows open, resolved and dismissed reports, with who reported what, the reason and details, and the review's text (a snapshot if its author deleted it).
  - Actions are **Dismiss**, **Hide review**, **Suspend** and **Restore** (review or account). Each needs a reason and is written to the audit log in the same database transaction. The page lists the latest actions.
  - Hidden reviews and suspended accounts' content leave movie pages, feeds, other people's views of profiles and collections, and the community average. Authors still see their own entries.
  - Suspended accounts can't add or edit entries, lists, follows, blocks, reports or their profile.
  - Settings links admins to the queue. See "Make yourself an admin" below.
- `/settings`:
  - Profile: avatar upload (see below), display name (max 60) and bio (max 300), saved by the `saveProfile` server action (zod, trimmed, blank fields removed).
  - Favorite genres and up to five favorite movies, reusing the onboarding forms, which save in place here.
  - Profile privacy (public, followers, friends, private) with a plain explanation of each mode.
  - Theme: System, Light or Dark. The choice applies at once, is stored in this browser, and is saved to `user_preferences.theme`. After sign-in the account theme wins; if the account has none yet, the browser's choice is saved to it. The header's light/dark toggle also saves once onboarding is finished. The account theme is fetched once per session (`/api/me?theme=1`), so a slow response can't undo a newer choice, and ordinary page loads skip that query.
  - Incoming follow requests (accept or decline), followers (remove) and blocked accounts (unblock).
  - Account deletion (see below).
- `POST /api/avatar` (and `DELETE` to remove): the raw image is the request body. It checks the site origin, a verified signed-in user with a username, and a limit of 10 uploads per hour. The body is capped at 2 MB while streaming. JPEG, PNG and WebP are accepted by their bytes, not the file name or browser MIME type (SVG, GIF and anything else are refused). `sharp` decodes the first frame only, with a pixel limit, then re-encodes to a 256×256 WebP with metadata such as EXIF/GPS removed. The file is stored with the user's own session under `avatars/<user id>/<random uuid>.webp`; every other file in that folder is then deleted, which also clears files orphaned by two uploads at once. The bucket is public for reads by URL and stores only WebP. Only the owner can list, add or remove files in their folder. Direct uploads that skip this route are held to the same shape by the database: `<uuid>.webp` names only, a verified account with a username, and at most three files.
- Account deletion requires a sign-in within the last 10 minutes, taken from the session's `amr` claim, which token refreshes don't change. Otherwise Settings asks for the password again, or Google for Google accounts. Password re-checks are limited to 5 per account per 15 minutes. The user must also type their username. `request_account_deletion(confirmation)` checks both again (the token's `amr` sign-in time and the typed username), so calling the RPC directly can't skip them. It then, in one transaction:
  - bans the auth user and ends every session;
  - deletes the profile and everything that cascades from it;
  - anonymises reports;
  - queues cleanup.

  Right after responding (`after()`), the server removes the avatar files and the auth identity with the service role (`src/lib/supabase/account-cleanup.ts`). A 404 counts as already done. If that fails, the queue keeps it, and `GET /api/cron/account-deletions` (Vercel Cron, daily, `Authorization: Bearer $CRON_SECRET`) retries it, least-attempted first so a few permanent failures can't block newer deletions. Nothing in the retry path can restore the account. Unsent entry drafts in the tab are cleared only once deletion has succeeded. `/account/deleted` explains what was removed and that provider backups expire on their normal schedule.

- `GET /api/me`: the signed-in user's username for that header link, their pending follow-request count for the Notifications badge, and (with `?theme=1`) their account theme or null (private, no-store; display only, never used for authorization). The header only calls it when a Supabase session cookie exists, so guests make no request and public pages stay static.

`src/lib/supabase/client.ts` supplies the browser client for future interactive data features; `server.ts` supplies a request-scoped cookie client. `src/middleware.ts` refreshes sessions with `getClaims()` and forwards updated cookies; this is **middleware.ts**, not Next.js 16's proxy.ts. It skips `/api/movies/search`, and only marks a response `private, no-store` when it refreshes auth cookies or the path is under `/auth` or `/account`, so public pages stay cacheable. `getClaims()` verifies the JWT locally when the project uses asymmetric JWT signing keys (otherwise it calls Auth), but cannot see sessions revoked since the token was issued, so protected pages and server actions independently verify identity via `getUser()`, never `getSession()`. Pages that call `getUser()` always render dynamically; `/about` and `/discover` are static. Callback redirects use the configured canonical origin and reject external `next` values. Auth responses are private/no-store and auth pages are noindex. Account information is not exposed to guests.

Passwords and provider error payloads are not logged. Supabase handles password storage and auth rate limits; configure its abuse controls before public launch.

### Rate limits

The database stores these limits and enforces them per account, so direct API calls can't bypass them:

- New entries: 20 per hour (edits aren't limited).
- Reports: 10 per day.
- Follow requests: 30 per hour. Only new or renewed requests count; asking again about an existing follow doesn't.
- Like changes: 100 per 10 minutes (no-op likes don't count).
- Comments and replies: 30 per 10 minutes (edits and deletes aren't limited).
- Avatar uploads: 10 per hour.
- Password re-checks: 5 per 15 minutes.
- Movie search and selection: see "Movie discovery setup".

An entry or report over the limit is refused with HTTP 429 and the number of seconds until it resets. The app says when to try again ("Try again in 13 minutes. Your draft is kept."). Drafts stay in the browser until a save succeeds, and the report form keeps its text. Counters use fixed windows and survive deletes and restarts.

To change the entry or report limits, run SQL like this in the Supabase SQL Editor:

```sql
update codebox_private.action_limit_settings
set max_actions = 30, window_seconds = 3600   -- 30 new entries per hour
where action = 'entry';   -- or 'report', 'follow', 'like' (100 per 600 s), 'comment' (30 per 600 s)
```

### Make yourself an admin

Admin status lives in the private `codebox_private.admin_roles` table. It has no API access, so there is no way to become an admin from the app. Sign up and finish onboarding with your own account, then run this once in the Supabase SQL Editor with your email address:

```sql
insert into codebox_private.admin_roles (user_id, note)
select id, 'project owner' from auth.users where email = 'you@example.com';
```

Sign out and back in if Settings doesn't show the moderator link, then open `/admin/reports`. To remove an admin, `delete from codebox_private.admin_roles where user_id = '<uuid>';`.

## Core preview status

This is an honest snapshot against SPEC section 2's core preview list. "Done" means it's built and covered by unit, database or browser tests. It doesn't mean it has been tested on your hosted project.

**Done**

- Accounts:
  - Email/password and Google sign-in, verification, password reset.
  - Onboarding: username, favorite genres and movies.
  - Settings: profile, avatar, theme, privacy, blocked accounts.
  - Account deletion with a retried cleanup.
- Movies:
  - Discovery and search, and movie detail pages from TMDB, with a cache fallback.
  - The CodeBox community average, kept separate from TMDB's score.
- Logging:
  - The 0.0–10.0 score (one decimal), reviews with spoiler flags, watched dates and repeat watches.
  - A diary, a watchlist and custom lists.
- Profiles:
  - Collections that visitors can sort, with four privacy modes.
  - Follow, request, cancel, unfollow and remove-follower from profiles, `/people` and `/notifications`.
  - `/people` username search and public profile discovery.
  - Public reviews that stay visible when a profile is restricted.
- Safety:
  - Blocking from profiles and review cards.
  - Reports on users, reviews, comments and replies.
  - The admin queue with audited dismiss, hide, suspend and restore.
  - Persisted limits on new entries, reports, follow requests, avatars and password re-checks.
- Home: Following and Community feeds with cursor pagination and a find-people prompt for new users.
- `/reviews/[id]`: likes; one-level comment threads with spoiler flags, owner edit and delete, and "[deleted]" placeholders; deleting a review removes its likes and discussion.
- Light and dark themes with no flash, and no horizontal scrolling at 360 px.

**Not built yet** (SPEC's social and personalization milestones)

- The full notification inbox. `/notifications` shows follow activity only: no comment or reply notifications, no unread state, no polling.
- Movie review lists: "most liked" and Following filters (only newest first and written-only exist).
- Recommendations and taste matching.
- The contextual right column on wide screens.

**Known gaps and limits**

- Users aren't told when a moderator hides their review or suspends them. The author still sees a hidden review as normal, and suspended users only find out when an action is refused.
- There is no appeal flow; restores happen only from `/admin/reports`.
- Spoiler reviews and comments are hidden in the page and from screen readers until revealed, and never appear in metadata or feeds. Their text is still included in the page's serialized component data (not visible markup), so anyone reading the raw HTML source can see it.
- Blocks and list changes aren't rate-limited yet.
- Direct Storage uploads can place up to 3 files that weren't re-encoded (named `.webp`) in the user's own avatar folder. The app never uses them.
- Not yet checked on the hosted Supabase project:
  - the database functions that write to the `auth` and `storage` schemas (account deletion, avatar policies)
  - email delivery on the deployed origin
- SPEC section 14's manual checks (keyboard-only flow, 200% zoom, modal focus) haven't been done as a full pass.

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

Import this repository as a Next.js project. Add all seven environment values, set the canonical HTTPS origin, and update Supabase and Google origins/redirects. Build with `npm run build`. Do not deploy this repo with `.env.local` committed. Do not add service-role keys to browser variables. `vercel.json` schedules the daily account-deletion retry; Vercel sends `CRON_SECRET` automatically once it is set. Auth secrets and test accounts are not bundled in the repository.

Official references: [Next.js 15 installation](https://nextjs.org/docs/15/app/getting-started/installation), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [email/password authentication](https://supabase.com/docs/guides/auth/passwords).
