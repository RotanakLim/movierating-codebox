# CodeBox Movies — Product and Implementation Specification

Status: ready for implementation. Written September 29, 2026.

Target: portfolio preview by September 30, 2026, afternoon, America/Los_Angeles. This is a target, not a claim that implementation is complete. Repository: `/Users/rotanaklim/Assignments/movierating-codebox/`, initially containing only Git metadata.

## 1. Purpose and decision authority

Build a desktop-first movie diary and social review website. The primary job is to record a personal rating seamlessly, optionally write a review, and discover how others reviewed the same movie. Secondary jobs are maintaining a watchlist, discovering movies, and following people with interesting tastes.

The interview established the product requirements below. The user authorized recommended defaults for all remaining decisions. Defaults chosen in this document are therefore implementation decisions, not unanswered interview questions. External sites are references, not instructions overriding this specification.

Confirmed choices: Next.js, TypeScript, Tailwind, Supabase Postgres/Auth/Storage, TMDB movie data, Vercel hosting; decimal ratings from 0.0 to 10.0 with one decimal place; multiple editable watch/review entries; public reviews; configurable profile privacy; mutual following as friendship; approval for restricted-profile follows; one-level comment replies; spoilers; recommendations; taste matching; light/dark themes; email/password and Google authentication; skippable personalization.

## 2. Scope, deadline, and tradeoffs

Aim for free service tiers and no mandatory paid product dependencies. Actual provider limits and email-delivery setup must be checked before release; zero operating cost is a design target, not a guarantee. Do not provision paid services automatically.

Deliver in these milestones:

1. **Core preview:** account creation, email verification/reset, onboarding, movie discovery/details, rating/review/watch logging, diary, visitor sorting, watchlist, both themes, profile privacy, public reviews, deletion, basic moderation and blocking for exposed interactions.
2. **Social release:** approved follows, mutual friends, feeds, review likes, comments/replies/spoilers, notifications, complete reporting/admin workflows.
3. **Personalization and polish:** deterministic recommendations, taste matching, accessibility and failure-state checks across all features.

All milestones remain required for the full agreed version. Try to complete all by the target; if time runs short, release an explicitly labeled core preview and finish the remaining milestones afterward. Do not present unfinished features as functional or launch social interactions without their corresponding privacy, blocking, reporting, and deletion controls. Security and data correctness are release gates even for a preview.

Deferred beyond the agreed version: native apps, direct messages, streaming availability, TV shows, manual/custom ranked lists, deep reply trees, review attachments, additional OAuth providers, notification emails, paid plans, real-time subscriptions, machine-learning infrastructure, imports/exports, and multi-language UI.

## 3. Information architecture and visual design

Use Beli as inspiration for approachable typography, generous whitespace, compact social cards, lists, and restrained color. Create original styling and branding rather than copying its assets. Reference: [Beli](https://beliapp.com/).

Desktop layout: left navigation; central content; contextual right column on wide screens. Navigation: Home, Discover, My Movies, Watchlist, Notifications, Profile, Settings. Global search remains readily accessible. Optimize for 1280–1440 px widths. Collapse secondary columns on tablets and navigation into an accessible compact menu on phones; no horizontal overflow at 360 px.

Support light and dark themes using semantic Tailwind tokens. Start with the system preference; explicit light/dark selection persists locally and to account settings after login. Avoid a theme flash. Use muted teal as the initial accent, high-contrast text, subtle borders, rounded cards, and poster thumbnails. Honor reduced-motion preferences.

Routes:

| Route | Purpose |
| --- | --- |
| `/` | Signed-in dashboard or public discovery/home |
| `/discover` | Movies, title search, genre/year browsing, recommendations |
| `/movies/[tmdbId]` | Movie details, scores, logging actions, reviews |
| `/reviews/[id]` | Public rating/review and discussion |
| `/u/[username]` | Profile or restricted profile shell |
| `/me/movies`, `/me/diary`, `/me/watchlist` | Owner collections |
| `/people` | Username search and public user discovery |
| `/notifications` | Inbox and follow requests |
| `/settings` | Profile, theme, privacy, blocked users, account deletion |
| `/auth/*`, `/onboarding` | Sign-up, sign-in, verification, password reset, personalization |
| `/admin/reports` | Admin-only report queue |
| `/about` | Product explanation and TMDB credits |

Signed-in home combines Following/Community feed tabs, a compact recent-movies panel, watchlist shortcut, and recommendations. Following is the default when accepted follows exist. New users get Community activity and a find-people prompt. Do not fabricate community activity when the database is empty.

## 4. Accounts and onboarding

Guests can browse movie details, public rating/review content, public discussions, and public profiles. Accounts are required for all mutations, including reviews, comments, replies, likes, follows, watchlists, reports, and watch logs. Require verified email before social contributions. A guest action opens sign-in and preserves a safe internal return destination and unsent draft for resumption, without automatically submitting it.

Use Supabase email/password and Google OAuth auth, confirmation email, resend verification, sign-out, and password reset. Google OAuth was added by the September 29 implementation request and supersedes the earlier email-only scope. Require at least 12 password characters and allow password managers/paste. Use generic reset responses to reduce account enumeration. Handle expired links and sessions with actionable messages.

Username is mandatory before publishing: 3–24 lowercase letters, digits, or underscores, case-insensitively unique; reserve system route/admin names. Keep usernames immutable for v1 to simplify durable links. Display name is optional (max 60 characters), bio optional (max 300). Avatar uploads: JPEG/PNG/WebP, max 2 MB, server-validated and re-encoded; no SVG or arbitrary file uploads. Avatar and username are always public.

Onboarding: establish username → choose favorite genres and up to five favorite movies → home. Genre/movie selection may be skipped and revisited in settings. No fabricated ratings or watch logs are created from favorites. Default profile privacy is public, clearly disclosed before completion.

## 5. Movie data, discovery, and details

Movies only, English interface, worldwide catalog, US release-date preference where available. Exclude TMDB adult-flagged records. TMDB ID is the canonical identity; show title and year to distinguish remakes. Missing dates, posters, runtime, trailers, or cast produce neutral fallbacks rather than broken UI. Unreleased films can be watchlisted; rating/review/watch contributions open on the earliest known release date. Unknown release dates do not prohibit contributions.

Movie pages include poster/backdrop, title, year, synopsis, runtime, genres, principal cast, trailer link when available, CodeBox average/count, separately labeled TMDB score/count, primary Rate or review action, Log a watch, and Watchlist toggle. External trailers open from explicit user action; no autoplay.

Discovery has title search, genre and year filters, and pagination. Search is debounced about 300 ms, cancels obsolete requests, and encodes filters in the URL. Use TMDB title search for text, and discover for genre/year browsing. If combining genre with title search requires local filtering, label results as filtered fetched search results; never imply a complete global filtered total. Continue fetching via Load more and distinguish no matches yet from exhausted results. Year filtering should use the supported provider parameter when possible. Preserve search state on return from a movie page.

## 6. Logging, ratings, and personal movie collections

Rating scale is a decimal score from 0.0 to 10.0 with exactly one decimal place (e.g. 1.0, 5.0, 9.5). Store it as a `numeric` that the database rejects (never rounds) beyond one decimal place; NULL means unrated. Values outside 0.0–10.0 or with more than one decimal place are invalid. There is no star rating. The control supports mouse, keyboard, touch, and explicit accessible text such as “9.5 out of 10.”

An entry contains optional rating, optional review text, spoiler flag, watched boolean, nullable watch date, creation/update timestamps, and author/movie IDs. It must contain at least a watched flag, a rating, or nonempty review text. Review text is plain text with line breaks, maximum 5,000 characters; the spoiler flag is a control, not a requirement to type Markdown syntax.

Allow all of these:

- Watched with no rating and no review.
- Rating and/or written review without marking watched.
- Watched with a rating and/or text.
- Multiple entries for repeat watches, with independent editing and deletion.

Watched defaults to true in Log a watch; its date defaults to today in the user's detected IANA timezone. Allow past dates or explicit “Date unknown”; prohibit future watch dates. Rating without watching has no watch date. Date-only values must not shift on timezone conversion. Creation timestamps use UTC.

Primary Rate or review edits the existing current rated entry when present, otherwise the most recently created entry; it opens a new entry only when none exists. Show which entry is being edited. Log another watch always creates a fresh entry and defaults to today. Each diary row has direct Edit/Delete actions.

Saving a watched entry atomically removes the movie from that owner's watchlist. A rating without watching leaves the watchlist intact. Users may later re-add a watched movie for a rewatch. Deleting/unmarking a watch does not automatically restore a watchlist item.

### Current rating selection

Consider only active, non-moderated entries with a rating. Select the most recent known watch date first. If dates tie, use newest creation timestamp, then ID. Only if no dated rated entry exists, select the newest-created unknown-date/unwatched rated entry. Editing text does not change ranking; changing rating/date does. A later unrated watch does not erase an earlier rating. Delete/removal recomputes the current rating from remaining eligible entries.

Example: June 1 = 8.0, September 1 = 6.5 → current is 6.5. Adding a January 1 entry today does not change it. Adding an undated 10.0 entry does not supersede it. Deleting September's entry restores June's 8.0.

The personal movie collection contains one row per movie with current rating, last known watch date, and watch count. Visitor sorting: rating descending (default), rating ascending, title A–Z, or latest watch date. Unrated/unknown dates sort last; deterministic title/movie-ID ties. Provide rated/watched filters. This is a sortable collection, not a manually ordered ranking. Diary contains distinct watched entries, with unknown-date items clearly grouped. Unwatched review/rating entries remain accessible in the collection and public review surfaces.

## 7. Public reviews, scores, comments, and spoilers

Every entry containing a rating or review text has a public review projection, regardless of profile privacy. Rating-only entries are public. Watched-only entries are visible only under profile access rules. Public projections contain username/avatar, movie, rating, review text, spoiler flag, and publication/edit timestamps; never expose private watch dates, watched status, or private profile fields. Public reviews can reveal movie opinions despite restricted profiles; state this explicitly in onboarding, composer, and privacy settings.

Community movie average uses one current rating per author, not one per watch. Include restricted-profile users' public ratings. Show one decimal and number of raters; no ratings displays “Not rated yet.” Do not blend TMDB and CodeBox scores. Moderated/deleted ratings are excluded. User blocking changes displayed content, not the public community aggregate.

Movie review lists default to newest published, with most liked and Following filters. Offer a written-reviews-only toggle. Public review pages support one like per user per review, reversible; self-likes are disabled. Counts come from the database.

Comments and replies require nonempty plain text, maximum 2,000 characters. One reply level: replies to replies are attached to the top-level thread and may display a reply-to username. Validate that every reply belongs to the same review; do not allow reparenting. Owners can edit/delete their comments and replies; mark edited text. Paginate top-level discussions and replies.

Optional whole-text spoiler flags cover reviews, comments, and replies independently. Hidden text is replaced by a reveal button; ratings stay visible. Do not place hidden spoiler text in previews, notifications, page metadata, or initial screen-reader output. Reveal is local UI state and does not change other users' views.

Deleting a comment with replies replaces its body/author presentation with “[deleted]” while preserving the thread. Deleting a review removes its likes and entire discussion, with a clear confirmation. Removing an entry also updates rating aggregates, collections, taste scores, and related feed/notification targets.

## 8. Privacy, relationships, and feeds

One profile privacy setting controls display name, bio, favorites, collection, diary, watchlist, social graph/counts, and taste matching. Username/avatar remain public. Email, account settings, blocks, reports, and notifications are always private.

| Mode | Who can access profile contents? | Follow behavior |
| --- | --- | --- |
| Public | Everyone | Immediately accepted |
| Followers only | Owner and accepted inbound followers | Request requires owner approval |
| Friends only | Owner and mutual accepted followers | Request requires owner approval |
| Private | Owner only | Requests may be accepted, but do not grant profile access |

Restricted profile shell exposes only username, avatar, restriction message, and appropriate follow/request/report/block controls. No hidden counts, lists, bio, or taste score. Public reviews remain discoverable on movie/review/community surfaces, not as a private profile diary tab. Profile restriction is not anonymity.

Friends are two accepted directional follows; there is no separate friendship object. Requests support pending, accept, decline, cancel. Users can unfollow or remove followers. No self-follow or duplicate follow requests. A declined request has a 24-hour retry cooldown. Changing profile privacy preserves accepted relationships, leaves pending requests pending, and immediately re-evaluates access. Removing either follow ends friendship access immediately.

Following feed contains new public ratings/reviews from accepted follows, plus watched-only activities where profile access allows. Community feed contains public ratings/reviews only. Create one feed event per entry, choosing the public review variant when applicable to prevent duplicate posts. Publication time controls order, not historical watch date. Edits update the card without bumping it. Likes, comments, and watchlist changes do not create feed posts. Privacy must be checked at read time, including pagination; changing privacy invalidates personalized caches.

Blocking removes both directional follows and pending requests, hides the accounts' content from each other while signed in, and prevents further follow requests, likes, comments, and replies between them, including interactions on their reviews. Existing interactions are hidden for the pair, not globally erased. Unblocking does not restore follows. Public content remains accessible while logged out; disclose this in block confirmation. Prevent blocked replies even through direct API calls.

## 9. Notifications and moderation

In-app inbox only; transactional authentication emails are separate. Notify on follow request, accepted request, new immediate follower, review comment, and reply. Likes do not notify in v1. Do not notify self-actions; de-duplicate by event and recipient. Support unread count, mark read, and mark all read. Poll on focus and at most every 60 seconds while the inbox is active; no real-time infrastructure required.

Notification text omits spoilers and private profile data. Recheck visibility when reading/opening a notification; removed or inaccessible targets yield “This content is no longer available.” For a reply that would notify both review and comment owners, send at most one notification to each recipient.

Verified users can report reviews, comments/replies, and users for spam, harassment, inappropriate content, spoilers, or other, with optional details up to 1,000 characters. One open report per reporter/target. Report identities/details are visible only to admins, not the reported user. The reporter sees a submission receipt.

Admin queue: open/resolved/dismissed status, target context, reason, timestamp; actions dismiss, hide content, suspend account, restore content/account. Require a reason for admin actions and audit them. Suspended users cannot mutate content; their authored content is excluded from public discovery and scores until restored. Admin status lives in protected server-managed storage, never editable user metadata. Provision the owner's admin role explicitly during setup, with no public role assignment path.

Account deletion requires recent reauthentication and a confirmation explaining permanence. Immediately disable account access and hide authored content; delete ratings, reviews/discussions, relationships, likes, notifications, watchlist, avatar, preferences, and auth identity through an idempotent cleanup operation. Comments on others' reviews become non-attributed tombstones if replies need them. Redact report payloads identifying deleted users; retain minimal non-identifying moderation audit entries. Interrupted cleanup remains queued/retryable and never restores visibility. Do not claim provider backups are immediately purged.

## 10. Recommendations and taste matching

Use transparent deterministic recommendations; no AI service or model training. Candidate movies come from TMDB similar/recommendation results for up to five current ratings of at least 8.0 and onboarding favorites, plus selected/high-rated genres. Deduplicate by TMDB ID. Exclude watched movies, already-rated movies, adult records, and unavailable records. Watchlisted-but-unwatched movies remain eligible, marked “On your watchlist.”

Rank by a deterministic combination: 3 points per seed movie yielding the candidate, 1 point per matching preferred genre; break ties by TMDB vote count then ID. Show a truthful explanation such as “Because you liked Arrival” or “Matches your science-fiction preference.” If no personal signals exist, show clearly labeled popular movies, not supposedly personalized suggestions. Cache personal results briefly and invalidate when relevant preferences/ratings/watch status change.

Taste score compares current ratings on shared movies. Require at least five shared rated movies; otherwise show “Not enough shared ratings.” Formula: round(100 × (1 − mean(abs(ratingA − ratingB)) / 10)), clamped to 0–100. This measures rating agreement, not a scientific compatibility prediction. Show shared-movie count beside the score. A viewer may request a comparison only if allowed to access both profiles and not blocked by either party. Do not compute/expose scores for arbitrary hidden user pairs through an API. Owner dashboard may compare the owner with accessible profiles.

## 11. Architecture and database design

Use Next.js 15 App Router with TypeScript and Tailwind, supported stable versions pinned in the lockfile at implementation time. Server components handle initial reads; small client components handle composer, rating controls, filters, and theme. Use server actions/route handlers for validated mutations and provider calls. Supabase provides Postgres/Auth/Storage; deploy web to Vercel. Keep a single application and database, without separate workers/services unless required for reliable cleanup.

TMDB tokens, Supabase privileged keys, and SMTP credentials are server-only. Normal user queries use a session-bound client with row-level security. Privileged credentials are restricted to audited admin/account-cleanup operations. Validate sessions and authorization on every mutation, not just navigation.

Suggested logical schema:

| Entity | Key fields / constraints |
| --- | --- |
| `public_identities` | auth user ID, unique normalized username, public avatar path |
| `profile_details` | user ID, display name, bio, visibility, preferences/favorite movies |
| `user_settings` | owner-only theme/timezone/settings |
| `movies` | TMDB ID, cached metadata, cached_at, unavailable marker |
| `entries` | UUID, user/movie, decimal score (0.0–10.0), text, spoiler, watched, nullable date, timestamps, version, moderation status |
| `watchlist` | unique user/movie, added_at |
| `follows` | unique follower/followee, pending/accepted, request timestamps |
| `blocks` | unique blocker/blocked, no self-block |
| `review_likes` | unique user/entry |
| `comments` | UUID, entry, author, top-level parent nullable, body, spoiler, timestamps, tombstone/status |
| `feed_events` | unique entry, publication time; access derived on read |
| `notifications` | recipient, actor, type, target, event key, read_at |
| `reports` | reporter, validated target/type, reason/details, status |
| `admin_roles`, `moderation_audit` | protected role assignment and audited actions |
| `deletion_jobs` | target account, cleanup stage, status/retries |

Implement current rating as a shared SQL query/view/function so profiles, averages, recommendations, and taste matching use identical precedence. Do not duplicate selection logic in several frontend components. Define constraints and indexes in migrations; include foreign keys and intentional cascades/tombstones.

RLS is mandatory on exposed tables. Separate public identity/review projections from private profile and diary data: row-level protection alone does not hide private columns in a public review row. Expose narrowly scoped projections/RPCs for public reviews; deny raw unauthorized entry access. Any security-definer function uses a fixed search path, explicit checks, minimal grants, and no arbitrary caller-selected identity. Ensure views do not inadvertently bypass policies. Supabase documents [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) as its database authorization mechanism.

Index entries by user/movie/date and publication time; relationships by each endpoint/status; comments by review/parent/time; notifications by recipient/read/time. Use cursor pagination with timestamp+ID ties, default 20 items. Persist idempotency keys for entry creation and notification events. Perform save+watchlist removal, relationship changes, and related notifications in transactions. Use version checks to reject stale edits with a reload/compare prompt.

## 12. Security, reliability, and accessibility

Validate inputs on server and client. Never render raw user HTML. Enforce content lengths, rating range and one-decimal precision, dates, parent relationships, target ownership, and verified-user status in the backend. Restrict avatar bucket writes to the owner and public reads to approved avatar files; usernames/avatars are intentionally public.

Persist mutation throttles in shared storage, not process memory: initial limits per user are 20 entries/hour, 30 comments/replies per 10 minutes, 30 follow requests/hour, 100 like changes/10 minutes, and 10 reports/day. Make limits configurable; return a retry time and preserve drafts. Apply separate bounded per-IP throttles to guest/provider endpoints and rely on configured auth abuse controls. Do not log passwords, tokens, or review drafts.

Optimistically update reversible likes/watchlist controls with rollback on failure. Confirm review saves only after server acknowledgment. Preserve unsent composer text in session storage through navigation/auth interruptions, scoped to account/movie and cleared on successful save or logout. Never submit stale drafts automatically. Disable duplicate submissions and use backend idempotency as the final protection.

Cache public movie metadata for roughly 24 hours, search for 5 minutes, and personal recommendations for up to 15 minutes. Never place private or viewer-dependent content in shared public caches. On provider timeouts or rate limits, serve stale cached metadata with an indication where possible; otherwise show Retry. Existing cached movie pages and local reviews should remain usable during TMDB outages. Missing provider records retain existing entries with a “Details unavailable” shell. Bound retries and honor provider retry instructions.

Provide skeletons, intentional empty states, offline/save errors, expired-session recovery, and separate not-found/restricted views without leaking private contents. Do not lose an existing list because its next page failed. Ensure pagination cannot resurrect deleted/blocked content.

Accessibility target: WCAG 2.2 AA practices, semantic landmarks, keyboard navigation, visible focus, labeled inputs/errors, sufficient contrast in both themes, meaningful poster alternatives, modal focus trapping/restoration, keyboard rating control, accessible sort/filter controls, and status announcements. Destructive actions require clear confirmation. At 200% zoom core flows remain usable.

Performance target under representative desktop conditions: primary cached pages LCP under 2.5 seconds, CLS under 0.1; avoid blocking review interactions on recommendation fetches. Optimize poster sizes and lazy-load below-fold media. These are verification targets, not guaranteed service-level promises.

## 13. Deployment and operational setup

Commit reproducible schema migrations, lockfile, setup README, and `.env.example` with placeholders only. Required configuration: Supabase URL/publishable key, server-only privileged key for narrow admin tasks, TMDB token, app origin/auth callback allowlist, and SMTP settings configured in Supabase. Use separate development data and production configuration. No real user credentials in seed data.

Public email/password signup requires working transactional email. Supabase's default SMTP is restricted and not suitable for general public signup; configure custom SMTP, sender identity, and verification/reset links before opening registration. See [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp). Provider selection is a deployment choice based on an available account and verified sender, not a new product interview dependency.

Use Vercel's generated domain initially and avoid paid add-ons. Free-tier usage ceilings can interrupt availability; review the actual dashboard and [Vercel Hobby documentation](https://vercel.com/docs/plans/hobby) before release. Track errors and quota consumption with basic provider dashboards and structured logs. Do not promise paid-service uptime on a free deployment.

TMDB requires attribution for noncommercial API usage. About/Credits must include the approved TMDB logo and this notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.” Keep CodeBox branding primary and link to TMDB. See [TMDB FAQ](https://developer.themoviedb.org/docs/faq). Recheck terms if monetization is introduced.

Implementation of the website, provisioning accounts, purchasing services, and deployment are subsequent work; this task's deliverable is the specification.

## 14. Acceptance tests and release gates

Use focused unit tests for pure rating/taste/recommendation rules, database integration tests for authorization and transactions, and browser tests for main journeys. Typecheck, lint, and production build must pass. Required scenarios:

1. Guest discovers a movie, drafts a review, signs up/verifies, resumes, and explicitly saves once; no duplicate entry or lost text.
2. Any score from 0.0 to 10.0 in 0.1 steps can be entered by keyboard; invalid API values (below 0, above 10, or more than one decimal place) are rejected.
3. Watched-only, rating-only, review-only, and full entries persist correctly. Only marking watched removes a watchlist item; saving and removal are atomic.
4. Rewatch, historical backfill, unknown date, equal-date tie, edit, deletion, and moderation produce the specified current rating. One person counts once in the community score.
5. Visitors sort profiles without mutating the owner's collection. Unknown dates and unrated movies sort consistently.
6. Privacy matrix is tested using guest, unrelated user, pending follower, accepted follower, mutual friend, owner, blocked user, and admin. Test direct database/API access, not just hidden UI. Restricted profile fields and watch dates never leak through public review projections, counts, feeds, metadata, or caches.
7. Public ratings/reviews remain visible with username/avatar when the author restricts their profile. Taste APIs refuse inaccessible profile comparisons.
8. Follow approval, decline/cancel, mutual friendship, unfollow, follower removal, and privacy changes immediately update access. Concurrent duplicate requests cannot create duplicate edges.
9. Comments/replies enforce one level and same-review ancestry; owners can edit/delete. Spoiler text stays out of previews/notifications and is revealed only on request.
10. Blocking through either direction rejects new prohibited interactions even through direct requests; old relationships are removed and not restored on unblock.
11. Comment deletion preserves needed replies; review deletion removes its discussion and updates scores. Account cleanup can retry after partial failure without making content public again.
12. Notifications are recipient-only, de-duplicated, correctly unread/read, omit self-events, and handle inaccessible/deleted targets.
13. Reports are private; a normal user cannot assign admin roles, inspect the queue, or moderate content. Admin actions are audited and removals affect scores.
14. Taste matching below five shared movies shows the empty state; identical ratings give 100 and maximal disagreement gives 0. Recommendations have truthful reasons, exclude rated/watched movies, and mark watchlisted suggestions.
15. TMDB timeout/429, missing images, empty searches, failed pagination, expired sessions, failed saves, duplicate clicks, and conflicting edits all produce recoverable states.
16. Verification and password reset work on the deployed origin for a non-team email address. Secret keys never appear in browser bundles or logs.
17. Desktop light/dark themes, 360 px layout, keyboard-only flow, modal focus, spoiler controls, and 200% zoom pass manual checks. Public indexing excludes restricted profile details and spoiler bodies.

Release checklist: migrations applied; RLS tests pass; auth email delivery verified; public attribution present; admin account provisioned securely; no fake community data in production; privacy/block/deletion tests pass for every exposed feature; production build works; milestone status honestly documented. No unresolved product decisions remain; operational credentials and accounts are supplied during implementation.


## 15. Core database implementation amendment (September 29, 2026)

The subsequent database request specifies the concrete names `users`, `movies`, `rankings` (renamed to `entries` on September 30), `follows`, `lists`, and `activity`. These supersede the suggested names in section 11 for the implemented core. Supporting `list_items` and `blocks` tables provide list membership and the existing privacy/blocking contract. `DATABASE.md` is the integration reference for these migrations.

- `users` contains username/avatar, a constrained profile object (display_name/bio), and profile visibility. Auth owns email/password. Safe identity and review projections preserve the section 8 privacy boundary.
- `movies` caches only TMDB ID, title, poster path, year, and cache time. Detailed movie metadata stays with TMDB.
- `entries` (created as `rankings`, renamed on September 30): multiple editable entries per user/movie preserve the diary. The only rating is the decimal `score` (0.0–10.0, one decimal place; NULL = unrated). There are no star ratings, buckets, comparisons, or manual ranking positions.
- `current_entries` and `public_current_ratings` apply the existing known-date / unknown-date / creation-time / ID precedence. A watch with no score does not replace a rated opinion. Raw collections follow profile privacy; public projections omit watch metadata.
- `follows` uses `following_id` for the target and keeps pending/accepted/declined state; only constrained RPCs create and approve relationships.
- Ordinary custom movie lists are now in scope alongside the watchlist. They are collections; the earlier deferral of a manual custom ranked-list workflow remains. Both custom lists and the default watchlist inherit profile visibility.
- Onboarding preferences live in owner-only `user_preferences` (favorite genre IDs) and `user_favorite_movies` (at most five, referencing cached `movies`), in place of the suggested `profile_details` preferences field. Favorites never create entries, ratings, or activity. Username rules are defined once in the database (`valid_username()`), and availability is checked through a signed-in-only RPC.
- `activity` replaces the suggested feed_events name. Triggers author one event per ranking; edits preserve publication time, and deletion cascades. Feed summaries contain no spoiler text.

- Settings (September 30):
  - Avatars live in a public `avatars` Storage bucket, with owner-only writes under `<user id>/`, re-encoded to WebP on the server.
  - The account theme is `user_preferences.theme`, where NULL means never chosen.
  - Account deletion is two steps. `request_account_deletion()` immediately disables sign-in, ends sessions, removes the profile and all cascading content, and anonymises reports. A service-role cleanup, idempotent and retried by a scheduled job, then removes avatar files and the auth identity.
  - Recent re-authentication means a sign-in within the last 10 minutes, per the session's `amr` claim.
  - The database enforces the recent sign-in and the typed username itself, so the account-deletion RPC can't be called around the app's checks. Direct Storage uploads are limited to the server's file shape (`<uid>/<uuid>.webp`), verified contributors and three files per user.

- Moderation (September 30):
  - Admin status is the private `admin_roles` table (in `codebox_private`), provisioned with SQL by the owner.
  - Moderation state is kept in private `hidden_entries` and `suspended_users` tables instead of an `entries` moderation-status column, and every admin action goes to the private `moderation_actions` table (the suggested `moderation_audit`).
  - Reports cover users and reviews, with the database choosing the review's author and keeping a snapshot.
  - Per-user limits on new entries (20 an hour) and reports (10 a day) are enforced in the database and configurable there.

- Social (September 30): the home feeds read `activity_feed` (Community: public ratings and reviews) and a `following_feed` view (accepted follows, with profile access checked per row). People search is the `find_people()` function. Follow requests are limited to 30 per user per hour in the database.

- Review discussions (September 30): `review_likes` and `review_comments` (top-level plus one reply level, `reply_to_user_id` for replies to replies, tombstones for deleted comments with replies) implement the suggested `review_likes` and `comments` tables (named `review_comments`). Clients reach them only through database functions that enforce visibility, blocks, ancestry and limits (100 like changes and 30 comments per 10 minutes).

- Notifications (September 30): `notifications` rows reference their event (no copied text) and are created by triggers on follows and review comments; the inbox, badge and access re-checks read through database functions.

The migrations implement this database subset, not the complete product. The comment, notification and aggregate/taste features remain subsequent work. Trusted movie ingestion must enforce release/adult restrictions before exposing a writable movie, since the cache intentionally omits detailed release metadata. Hosted migration application is a separate deployment step.
