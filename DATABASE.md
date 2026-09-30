# CodeBox Movies database

Ordered Supabase SQL migrations implement the requested core tables, RLS, constrained writes, and feed automation. They have **not** been applied to a hosted project.

## Apply

Preferred workflow with the Supabase CLI, from this repository:

```sh
npx supabase start
# Local, disposable database only: reset recreates local data and applies migrations.
npx supabase db reset
```

`supabase/config.toml` (from `supabase init`) is the local CLI configuration; it does not create hosted resources. After changing a migration, run `npm run db:types` to regenerate `src/lib/supabase/database.types.ts`. A Docker-compatible runtime is required for the local Supabase stack. Keep `codebox_private` out of the API's exposed schemas.

When ready to apply to your own hosted project, inspect the SQL first and follow the checklist in [README.md](README.md#apply-migrations-to-my-hosted-project):

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Alternatively, run the contents of every migration file in the Supabase SQL Editor, in timestamp order, as the database administrator. Do not then reapply the same migrations through the CLI without first reconciling its migration history. No secrets belong in SQL files. Never run the test fixture on a live database.

Files:

1. `supabase/migrations/20260929000100_core_tables.sql`: tables, enums, constraints, indexes, RLS enabled, explicit revocation of default client grants.
2. `supabase/migrations/20260929000200_access_and_activity.sql`: policies, safe projections, lifecycle triggers, and follow RPCs. Also backfills profiles and watchlists for existing Auth users.
3. `supabase/migrations/20260929000300_movie_request_limits.sql`: private request counters and a service-role-only quota RPC for movie search and selection.
4. `supabase/migrations/20260930000100_remove_comparison_ranking.sql`: removes comparison buckets and positions.
5. `supabase/migrations/20260930000200_remove_decimal_score.sql` and `20260930000300_decimal_score_only.sql`: switch the rating to a star scale and back; the net result is the decimal `score` as the only rating.
6. `supabase/migrations/20260930000400_occasional_limit_cleanup.sql`: the quota RPC deletes day-old counters on about 1% of calls instead of every call.
7. `supabase/migrations/20260930000500_onboarding.sql`: `codebox_private.valid_username()` (the single source of username rules, now used by `users_username_format`), the `username_status()` availability RPC, owner-only `user_preferences` (favorite genres) and `user_favorite_movies` (up to five), and the `set_favorite_movies()` RPC.
8. `supabase/migrations/20260930000600_entries.sql`: renames `rankings` → `entries`, `current_rankings` → `current_entries`, `activity.ranking_id` → `entry_id`, the `ranked` activity kind → `rated`, and the guard/sync functions, constraints, indexes, policies and triggers to match. `score` becomes plain `numeric` so the database rejects extra decimals instead of rounding them.
9. `supabase/migrations/20260930000700_movie_rating_summary.sql`: `movie_rating_summary(movie_id)` returns the community average (0.0–10.0, one decimal) and rater count from one current score per author, using `current_entries` precedence. It is security definer so blocks never change it and restricted-profile authors' public scores count; it exposes only the two aggregates. Adds a partial index for it.
10. `supabase/migrations/20260930000800_profiles.sql`:
    - `user_movie_collection`: a security-invoker view with one row per user and movie, giving the current score (same precedence as `current_entries`), the last known watch date and the watch count. Entries RLS applies, so it only returns collections the viewer may see.
    - `profile_card(username)`: identity, privacy mode, access flag and the viewer's own relationship and follow status, for the restricted-profile shell. A viewer blocked by the owner gets only `unavailable`.
    - `my_blocked_users()`: the caller's own block list.
    - `reports`: user reports, one open report per reporter and target. Clients can insert but never read them; there is no admin queue yet.
    - A diary index on watched entries.
11. `supabase/migrations/20260930000900_settings.sql`:
    - The `avatars` Storage bucket: public reads by URL, 2 MB, JPEG/PNG/WebP. Policies on `storage.objects` let a signed-in user list and remove files only in `<their user id>/`, and add files only directly inside it. There is no public SELECT policy, so nobody can list other people's files. The app re-encodes every upload to WebP on the server first.
    - An `avatar` scope in the request-limit RPC: 10 uploads per user per hour.
    - `user_preferences.theme`: `system`, `light` or `dark`; NULL means never chosen. It is owner-only like the rest of the row.
    - `reports.reporter_id` and `target_user_id` become nullable with `on delete set null`, so reports outlive a deleted account without identifying it.
    - Account deletion:
      - `request_account_deletion()` is signed-in only and idempotent. It queues the user in the private `codebox_private.account_deletions` table, bans the auth user and deletes its sessions, redacts report details involving the user, and deletes the profile row. That delete cascades entries (and their activity), follows, blocks, lists and items, favorites and preferences.
      - `pending_account_deletions()` and `record_account_deletion_attempt(user, failure)` are service-role only; the server's retryable cleanup uses them.
12. `supabase/migrations/20260930001000_settings_hardening.sql`:
    - `request_account_deletion(confirmation)` replaces the no-argument version. The database now enforces the app's safeguards: a sign-in within the last 10 minutes (the newest `timestamp` in the token's `amr` claim, which refreshes keep unchanged), otherwise `42501`, and the account's own username as confirmation (case and surrounding spaces ignored), otherwise `22023`. A repeat after deletion is still harmless.
    - `pending_account_deletions()` returns the least-attempted rows first, then the oldest.
    - Avatar uploads: the bucket accepts only WebP (what the server stores). Direct uploads must be named `<uid>/<uuid>.webp`, need `can_contribute()` (verified email, username, account not deleted), and are capped at three files per user by `codebox_private.avatar_upload_allowed()`.
    - A `reauth` request-limit scope: 5 password re-checks per user per 15 minutes.

`POST /api/movies/cache` (no UI caller yet; rating and watchlist actions will use it) accepts only a TMDB ID. After checking session, verified email, origin, and quota, the server fetches trusted TMDB metadata and performs an idempotent service-role upsert. Browser clients still have no direct movie mutation grants.

Each migration is transactional and intended to run once through migration tracking. The first leaves tables inaccessible to clients until the second completes. SQL intentionally fails on conflicting existing tables instead of silently overwriting a different schema. Use forward migrations for later changes; rolling these tables back would destroy application data.

## Schema decisions

| Table                  | Meaning                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                | `id` references `auth.users`; username, avatar object path, `profile` JSON with only display_name/bio, visibility, timestamps. No email/password copies.                  |
| `movies`               | `tmdb_id` primary key; cached title, poster path, year, cached_at. No full TMDB JSON, cast, or synopsis copies.                                                           |
| `entries`              | An editable watch/review entry: user_id, movie_id, optional score, note, watched_date; plus spoiler flag, watched flag, timezone, version, timestamps.                    |
| `follows`              | Unique directional pair using the requested `follower_id` / `following_id` names; status pending/accepted/declined and timestamps. Mutual accepted rows imply friendship. |
| `lists`                | One automatically provisioned watchlist per user, plus owner-created custom lists. Both inherit profile visibility.                                                       |
| `list_items`           | Movies belonging to a list; unique list/movie pair, optional ordering position, added_at.                                                                                 |
| `activity`             | One structured event per ranking entry. Clients cannot fabricate feed rows.                                                                                               |
| `user_preferences`     | Owner-only onboarding/settings preferences: `favorite_genre_ids` (TMDB movie genre IDs, deduplicated and validated) and `theme` (system/light/dark, NULL = never chosen). |
| `user_favorite_movies` | Owner-only, at most five per user, each referencing a cached `movies` row; shown in the order picked. Never creates entries, activity, or watch logs.                     |
| `blocks`               | Supporting table for the SPEC's bidirectional block filtering and removal of follow relationships.                                                                        |

### Entries, repeat watches, and scores

The only rating is a **decimal score from 0.0 to 10.0** with one decimal place (e.g. 1.0, 5.0, 9.5), stored as `entries.score` (`numeric`). NULL means unrated. There are no star ratings, buckets, comparisons, or manual ranking positions. The `guard_entry` trigger rejects values with more than one decimal place (`23514`) instead of rounding them, then stores accepted values with one decimal place (8 → 8.0); a check constraint enforces 0–10. Migration `20260930000300_decimal_score_only.sql` removed the half-star rating, converting `star_half_units` 2–10 to scores 2.0–10.0 (4.5 stars = 9.0).

A ranking row represents a diary/review entry, allowing repeat watches of the same movie. Do not add a unique `(user_id, movie_id)` constraint: that would discard the SPEC's history. Custom lists are separately stored in `lists`/`list_items`; visitors can independently sort a profile collection.

`current_entries` selects one **rated** entry per user/movie, ordered by known watch date descending, then created_at and UUID descending. Known dates beat unknown dates. A later unrated watch does not erase a rating; deleting the current entry reveals the previous eligible one. `public_current_ratings` exposes just the public rating fields with the same precedence, without dates.

The movie page's community average comes from `movie_rating_summary()`, never from averaging `public_current_ratings`, because that view hides authors the viewer blocked or was blocked by. Reviews on the movie page read `public_reviews` (which does apply blocks) newest first with keyset pagination on `(created_at, id)`, 20 per page; no watch dates or watched status are ever selected.

`watched_date = NULL` means unknown for a watched entry, and is required for an unwatched entry. The UI should supply local today and its IANA `watched_timezone`; the database checks that the date is not in the future in that timezone. SQL defaults to unknown date and UTC when these values are omitted. Watched-only entries and note-only entries are allowed; an entirely empty unwatched entry is rejected.

Saving an entry with `watched = true` removes that user's movie from their watchlist in the same transaction. Rating without watching preserves the watchlist. Re-adding a watched movie later is allowed. Deleting or unmarking a watch never recreates watchlist items. Notes are trimmed to NULL if blank and limited to 5,000 characters.

Persist a client-generated UUID across retries and supply it as the ranking `id`; a duplicate request cannot create another row with the same ID. For stale-edit protection, constrain an update by both `id` and the previously read `version`; zero returned rows means the entry changed or is inaccessible. Successful updates increment version automatically. Identity, author, movie, creation time, and version cannot be forged with client column writes.

### Privacy and public projections

`users`, raw `entries`, lists, and list contents use profile visibility: public / followers / friends / private. Owners always have access. Followers require an accepted inbound follow; friends require accepted follows in both directions. An ordinary private-profile user cannot make all their reviews private: public review content is intentionally still public, as specified.

Read `user_identities` for public username/avatar, and `public_reviews` for public scoring/note/spoiler fields. These intentionally use narrow security-barrier definer views because public reviews must remain readable even when raw private diaries are not. **Never add private columns to these views.** They explicitly filter blocked authors. Other views use invoker security and underlying RLS. Public projections have SELECT-only grants.

Public views omit watched status, watch date, timezone, placement, and private profile JSON. `public_reviews` includes the spoiler flag and full note for explicit reveal; the UI must conceal flagged text and avoid embedding it into metadata or previews. `activity_feed` never includes any note text. A public rating can still reveal that someone has an opinion about a movie; privacy is not anonymity.

The current-rating views are viewer-filtered for blocks. A future global average must use a separate trusted aggregate that counts one eligible rating per user without changing according to the current viewer's blocks; do not derive a global total from this viewer-filtered response.

### Profile privacy matrix

`supabase/tests/core.sql` checks this matrix with direct SQL for the profile row, raw entries, the collection view, lists, list items, the social graph, `profile_card` and `public_reviews`:

| Viewer                      | public | followers | friends | private |
| --------------------------- | ------ | --------- | ------- | ------- |
| Guest                       | ✓      | –         | –       | –       |
| Unrelated user              | ✓      | –         | –       | –       |
| Pending follower            | ✓      | –         | –       | –       |
| Accepted follower (one-way) | ✓      | ✓         | –       | –       |
| Mutual friend               | ✓      | ✓         | ✓       | –       |
| Owner                       | ✓      | ✓         | ✓       | ✓       |
| Blocked (either direction)  | –      | –         | –       | –       |

Scores and reviews stay visible through `public_reviews` in every mode, except to a signed-in blocked account.

## Client permissions

- Guests: read movies, accessible profiles/collections/lists, public identities/reviews, and permitted activity. No mutation grants.
- Authenticated users: select an immutable username, update their own avatar/profile/privacy; create/edit/delete **only their own** entries and custom lists; manage only their own list items and blocks.
- Entry/list/social contributions additionally require a confirmed email and an onboarded username. The check reads `auth.users`, not editable user metadata.
- Onboarding: `username_status(candidate)` (signed-in only) returns `available`, `taken`, `invalid`, or `reserved`; it runs with definer rights so private or blocking accounts' names still count as taken. A username can be claimed once (the update must match `username is null`); duplicates fail with `23505`, reserved or malformed names with `23514`. `set_favorite_movies(movie_ids)` atomically replaces the caller's favorites under RLS. Preferences are written update-then-insert, because clients have no `UPDATE` grant on `user_id` and PostgREST upserts set every column.
- Clients cannot mutate movie cache data, feed events, author IDs, creation timestamps, or follow status directly.
- Avatars: users upload through the app's `/api/avatar` route with their own session. Storage policies allow writes only as `avatars/<own id>/<uuid>.webp`, by contributors, at most three files at a time, and `users.avatar` must point into the owner's folder. A direct upload can't skip those rules, but its bytes aren't re-encoded, so only the app's route produces avatars.
- Account deletion: a user can only delete their own account, through `request_account_deletion(confirmation)`, which requires a recent sign-in and their username. The queue table is unreadable by clients.
- `service_role`: trusted database access, bypassing RLS as Supabase intends. Only the server-side TMDB cache, request limits, account-deletion cleanup and future administrative operations use it. Never put it in `NEXT_PUBLIC_*`.

The policies use both `USING` and `WITH CHECK` for ranking updates. Column grants separately prevent ownership reassignment. RLS is enabled on **every** new table. Grants inherited from Supabase defaults are explicitly revoked before permitted operations are granted back.

## Integration examples

These snippets use the existing **session-bound** Supabase client, preserving RLS. Do not switch normal user writes to a service-role client.

```ts
// After auth, choose a username before posting.
await supabase
  .from("users")
  .update({
    username: "rotanak",
    profile: { display_name: "Rotanak", bio: "Always watching." },
  })
  .eq("id", user.id);

// Cache movies with a trusted server-only client, after fetching TMDB:
// cacheClient.from('movies').upsert({ tmdb_id, title, poster, year, cached_at });
// Do not accept an arbitrary user-supplied cache payload.

const entryId = crypto.randomUUID(); // Keep this same value across retries.
const { data, error } = await supabase
  .from("entries")
  .insert({
    id: entryId,
    movie_id: 693134, // Must already exist in the minimal cache.
    score: 9.5, // Optional: 0.0–10.0, one decimal place. NULL = unrated.
    note: "Beautiful film.",
    watched: true,
    watched_date: "2026-09-29", // UI supplies local today, or NULL for unknown.
    watched_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  .select()
  .single(); // user_id defaults to auth.uid(). Handle error explicitly.

// Stale edits return no rows when the expected version no longer matches.
await supabase
  .from("entries")
  .update({ note: "Updated thoughts." })
  .eq("id", entry.id)
  .eq("version", entry.version)
  .select();

// Privacy is enforced in SQL; a profile visibility toggle takes effect immediately.
await supabase
  .from("users")
  .update({ visibility: "friends" })
  .eq("id", user.id);

await supabase.rpc("request_follow", { target_id: otherUserId });
await supabase.rpc("respond_follow", {
  requester_id: otherUserId,
  approve: true,
});
await supabase.rpc("remove_follow", {
  other_id: otherUserId,
  direction: "outgoing",
});
// direction: 'incoming' removes someone following you. Unfollow is idempotent.

await supabase.from("lists").insert({ name: "Weekend picks", kind: "custom" });
await supabase.from("list_items").insert({ list_id: listId, movie_id: 693134 });
await supabase.from("blocks").insert({ blocked_id: otherUserId });

await supabase
  .from("activity_feed")
  .select("*")
  .order("created_at", { ascending: false })
  .order("id", { ascending: false })
  .limit(20);
```

For a Community feed, include only `rated`/`reviewed` events. For Following, filter actors by the viewer's accepted outbound follows; RLS still rechecks each event. Cursor pagination should use `(created_at, id)`; relevant indexes are provided. Editing an entry updates its displayed rating without adding a second event or bumping publication time.

`request_follow` accepts public targets immediately and creates pending requests for restricted targets. Only the recipient can approve or decline. A decline has a 24-hour retry cooldown; removing or blocking/unblocking a declined relationship does not erase it. Follow and block operations serialize by user pair to avoid approval/block races. Blocking removes pending and accepted follows in both directions; unblocking does not restore them. Public content remains readable when signed out.

### Account deletion

1. **Immediately, in one transaction** (`request_account_deletion(confirmation)`, after checking the recent sign-in and the typed username):
   - Sign-in is disabled (a long ban) and every session is deleted, so refresh tokens stop working.
   - The profile and everything that cascades from it disappear.
   - Reports stay but lose the person's ID and details.
2. **Then, with the service role** (`src/lib/supabase/account-cleanup.ts`): delete every file in `avatars/<id>/`, then the auth user (404 counts as done). Record each attempt, with a short non-identifying error on failure.
3. **Retries**: unfinished rows are retried, least-attempted first, by `GET /api/cron/account-deletions` (Vercel Cron with `CRON_SECRET`). Each step is idempotent, and nothing in the retry path can recreate the profile. The auth signup trigger only runs on insert, and clients have no INSERT grant on `users`. Completed rows keep only the user ID, timestamps and attempt count.

## Tests and scope

```sh
npm run test:db
```

The test runner applies all migrations to an isolated PGlite PostgreSQL engine and executes real SQL under `anon`, `authenticated`, and trusted roles. Only Supabase's auth schema/identity function and a minimal Storage schema (`storage.buckets`, `storage.objects` with RLS, `storage.foldername()`) are emulated. It needs no keys, network database, Supabase CLI, or Docker. The fixture is `supabase/tests/core.sql`; it creates synthetic users and is **not** a production migration or a pgTAP suite.

Coverage includes ownership attacks, direct-table writes, verified-email gating, projection leaks, profile visibility, follow approval/cooldown, blocking, constrained scores/dates, username rules/availability/duplicates, owner-only preferences and the five-favorite limit, default watchlists, list ownership, history selection, feed updates/deletion, Auth cascade cleanup, avatar storage policies, the theme preference, and account deletion (recent sign-in and confirmation enforced in SQL, immediate removal, session ending, report anonymisation, queue privacy, ordering and retry bookkeeping). The harness stubs `auth.jwt()` the same way Supabase defines it. A passing local engine test does not verify a hosted project's PostgREST exposure, API grants outside these migrations, Auth configuration, or concurrent multi-connection scheduling. Inspect Supabase security advisors and smoke-test the APIs after deploying.

This change is a database foundation. Movie search and selection are wired to the minimal movie cache; ranking and social forms remain future work. TMDB ingestion excludes adult movies. Release-date validation for future ranking writes remains to be implemented because this minimal cache does not store complete release metadata. Moderation/suspension, comments/likes, notifications and taste calculations remain subsequent implementation work. Comment tombstones for deleted accounts will be needed once comments exist. Do not treat these core migrations as completion of every feature in SPEC.md.
