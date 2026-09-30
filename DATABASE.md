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
13. `supabase/migrations/20260930001100_moderation.sql`:
    - `codebox_private.admin_roles`: the only source of admin status. There are no API grants and no policies, so admins are added with SQL by the project owner (see below). `codebox_private.is_admin()` also treats a banned auth user as not an admin.
    - Moderation state lives in `codebox_private.hidden_entries` and `codebox_private.suspended_users`, not on user-editable rows.
      - `public_reviews`, `public_current_ratings`, `movie_rating_summary()` and `can_view_activity()` skip hidden entries and suspended authors. They filter before choosing each author's current score, so an older visible score counts instead.
      - The entries read policy hides them from everyone but the author, which also covers profiles, diaries and `user_movie_collection`.
      - `can_contribute()` is false for suspended accounts, and they can't update their `users` row.
    - Reports now cover reviews:
      - A report is inserted with `target_entry_id`. The `reports_prepare` trigger sets `target_kind = 'review'`, the author as `target_user_id` (never the client's value) and an `entry_snapshot`.
      - Only public, visible reviews can be reported.
      - The trigger also enforces one open report per reporter and review (`reports_one_open_per_review`), or per reporter and user (`reports_one_open_per_user`).
    - Admin RPCs, each refusing non-admins with `42501`:
      - `admin_moderate(action, reason, report, target_entry, target_user)` handles `dismiss`, `hide`, `suspend` and `restore`. A reason of 1–1,000 characters is required, and the call writes one `codebox_private.moderation_actions` audit row in the same transaction. Hiding or suspending resolves the report and dismissing dismisses it. Closed reports can't be acted on again, and admins can't suspend themselves.
      - `admin_reports(status, max_rows)` and `admin_moderation_log(max_rows)`.
      - `is_admin()` and `my_account_suspended()` report the caller's own status.
    - Persisted per-user limits:
      - `codebox_private.action_limit_settings` (defaults: `entry` 20 per 3,600 s, `report` 10 per 86,400 s) and fixed-window counters in `codebox_private.action_limits`.
      - Triggers on `entries` (insert only) and `reports` raise `PT429`, which PostgREST returns as HTTP 429, with the seconds until reset in `details` and the action in `hint`.
      - A refused attempt rolls back and isn't counted. Accounts that can't contribute aren't counted either.
    - `request_account_deletion()` now also clears `entry_snapshot` in reports involving the account.
14. `supabase/migrations/20260930001200_social.sql`:
    - `following_feed`: a security-invoker view over `activity_feed`, limited to people the viewer follows (accepted). Activity RLS still applies, so blocks, hidden content, suspensions and profile access (for watched-only events) are enforced. Signed-in users only.
    - A partial index for Community pages: public ratings and reviews newest first.
    - `find_people(search, max_rows)`:
      - With a search, it matches username prefixes (only `[a-z0-9_]`, underscores taken literally) across all privacy modes. Without one, it lists public profiles by latest public rating or review.
      - It leaves out self, accounts either side has blocked, and suspended accounts.
      - It returns username, avatar, privacy mode, the viewer's follow status, and the display name only when the viewer may see the profile.
    - A `follow` action limit (30 per hour, configurable in `codebox_private.action_limit_settings`), consumed by `request_follow` only when it creates or renews a request (`PT429` otherwise).
15. `supabase/migrations/20260930001300_review_discussions.sql`:
    - `review_likes` (one per user per review) and `review_comments` (top-level or one reply level). Clients have **no** table grants; everything goes through security-definer functions:
      - `review_details(id)`: the review, author, movie, like count (excluding suspended likers), my like, visible comment count and whether it's hidden. Returns no row unless the review is visible to the viewer.
      - `review_threads(id, after_at, after_id, page_size, reply_limit)` and `review_replies(thread, after_at, after_id, page_size)`: keyset pages. Each comment's state is `visible`, `deleted`, `removed` (moderator-hidden or author suspended) or `blocked` (either direction). Text and author are returned only when it is visible. A non-visible top comment is listed only while it has visible replies.
      - `set_review_like(id, should_like)`: refuses your own review, invisible reviews and blocked pairs. Only real changes count toward the limit.
      - `add_review_comment(id, text, spoiler, reply_to)`: 1–2,000 characters after trimming. A reply to a reply is stored on the same top-level thread with `reply_to_user_id`. It refuses other reviews' comments (`23514`), blocks between the commenter and the review author, the thread author or the person answered (`42501`), and moderated or blocked targets.
      - `edit_review_comment(id, text, spoiler)`: owner only; changed text sets `edited_at`.
      - `delete_review_comment(id)`: owner only. A top-level comment with replies becomes a tombstone (no body, no author); otherwise the row is deleted, and a tombstone left without replies goes too.
    - A `review_comments_guard` trigger enforces same-review ancestry and one reply level, and forbids reparenting, for every writer including the service role.
    - Deleting an entry cascades its likes and whole discussion.
    - Account deletion removes the account's likes and comments, turning its top-level comments that have other people's replies into non-attributed tombstones.
    - Limits: `like` 100 and `comment` 30 per 600 seconds (`PT429`).
    - Comment reports: `reports.target_comment_id` with `target_kind = 'comment'`, one open report per reporter and comment. The author and a text snapshot come from the database.
    - Moderation: `codebox_private.hidden_comments`. `admin_moderate` gains `target_comment` (hide/restore). `admin_reports` and `admin_moderation_log` return comment context.
16. `supabase/migrations/20260930001400_notifications.sql`:
    - `notifications` holds `recipient_id`, `actor_id`, `kind`, `event_key`, optional `entry_id`/`comment_id`, `created_at` and `read_at`. It stores references only, never text. There are no client grants.
      - `unique (recipient_id, event_key)` de-duplicates. Follow events use `kind:actor` and refresh on repeat. Comment events use `comment:<id>`, so a reply notifies each recipient at most once.
    - Triggers write the rows through `codebox_private.notify`, which skips self-notifications and blocked pairs:
      - On `follows`: `follow_request` (pending), `follow_accepted` (pending → accepted, to the requester) and `new_follower` (immediate follow). A request's notification is removed once it's accepted, declined or cancelled.
      - On `review_comments`: a reply notifies the thread author and the person answered with `comment_reply`, then the review author with `review_comment`.
    - Functions (signed-in callers, own rows only):
      - `my_notifications(after_at, after_id, page_size)`: newest first. It leaves out blocked pairs, and withholds actor and movie when the target is no longer available.
      - `my_unread_notification_count()` and `mark_notifications_read(ids | null)`.
      - `open_notification(id)`: marks it read and returns the target only if it's still available. Availability is re-checked each time: the follow is still in that state, and the comment is visible and its review viewable.
    - Rows cascade with their recipient, actor, entry or comment.
17. `supabase/migrations/20260930001500_feed_performance.sql` (no behavior change):
    - `codebox_private.can_view_profile`, `can_view_activity` and `comment_state` are plpgsql instead of SQL. They run once per row in RLS policies and `review_threads`; as non-inlinable SQL functions they were re-planned on every call.
    - `activity_feed` looks up the author (`user_identities`) and score (`public_reviews`) with `LATERAL (…) OFFSET 0` subqueries. A join key can't be pushed into a `security_barrier` view, so the old joins built the whole of `public_reviews` for every page. Same columns, still `security_invoker`.

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
- Reports: verified, non-suspended users insert reports about users (`target_user_id`) or reviews (`target_entry_id`). Nobody but admins can read them, and only through `admin_reports()`, never the reported person. Reporters can't set the status, kind or snapshot.
- Moderation: only accounts in `codebox_private.admin_roles` can call the admin RPCs. To add yours:

  ```sql
  insert into codebox_private.admin_roles (user_id, note)
  select id, 'project owner' from auth.users where email = 'you@example.com';
  ```

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

## Performance checks

`supabase/perf/seed.sql` loads a large local dataset (5,000 accounts, about 100,000 entries, 250,000 follows, busy discussions). `supabase/perf/explain.sql` then runs the app's RLS-heavy reads as one of those accounts and prints `EXPLAIN ANALYZE` plans. **Local stack only**: the seed creates thousands of fake accounts.

```sh
docker exec -i supabase_db_movierating-codebox psql -U postgres < supabase/perf/seed.sql
docker exec -i supabase_db_movierating-codebox psql -U postgres < supabase/perf/explain.sql
```

Measured on that data (local Postgres 17, warm cache), before and after migration 17:

| Query (first page unless noted)          | Before     | After     | Plan                                                    |
| ---------------------------------------- | ---------- | --------- | ------------------------------------------------------- |
| Following feed                           | 2,109 ms   | 47 ms     | `follows_outbound_status`, then `activity_actor_recent` |
| Community feed                           | 1,423 ms   | 2 ms      | `activity_public_recent`, stops after 21 rows           |
| Community feed, deep cursor (400 days)   | 1,660 ms   | 2 ms      | same index, keyset condition                            |
| Movie reviews list (busiest movie)       | 1 ms       | 1 ms      | `entries_movie_recent`                                  |
| Review threads (~400 comments)           | 58 ms      | 11 ms     | every comment on the review gets a state, then pages    |
| Inbox page / unread count (2,840 unread) | 12 / 23 ms | 7 / 22 ms | `notifications_inbox` / `notifications_unread`          |

The following feed still grows with how much the people you follow have posted: it collects their activity through `activity_actor_recent` and sorts it. Review threads compute every comment's state before paging, so they grow with the size of the discussion.

## Tests and scope

```sh
npm run test:db
```

The test runner applies all migrations to an isolated PGlite PostgreSQL engine and executes real SQL under `anon`, `authenticated`, and trusted roles. Only Supabase's auth schema/identity function and a minimal Storage schema (`storage.buckets`, `storage.objects` with RLS, `storage.foldername()`) are emulated. It needs no keys, network database, Supabase CLI, or Docker. The fixture is `supabase/tests/core.sql`; it creates synthetic users and is **not** a production migration or a pgTAP suite.

Coverage includes ownership attacks, direct-table writes, verified-email gating, projection leaks, profile visibility, follow approval/cooldown, blocking, constrained scores/dates, username rules/availability/duplicates, owner-only preferences and the five-favorite limit, default watchlists, list ownership, history selection, feed updates/deletion, Auth cascade cleanup, avatar storage policies, the theme preference, moderation (no public admin path, review reports with the database-chosen author and snapshot, hide/suspend/restore/dismiss with required reasons and audit rows, hidden and suspended content leaving public reviews, ratings, feeds, collections and the community average, suspended accounts refused), notifications (follow and comment events, no self-notifications, dedupe per event and recipient with one per reply, request cleanup, block filtering, owner-only reads and marks, access re-checks with withheld details), review pages (likes: one per user, no self-likes, blocks, limit; comments: one reply level, same-review ancestry for every writer, no reparenting, owner-only edit/delete, [deleted] tombstones, block and moderation masking, comment reports, cascades on review and account deletion), social feeds and search (Following limited to accepted follows and profile access, Community public-only, no review text in feed rows, prefix search with literal underscores and no leaked display names, discovery of public profiles only), persisted entry, report and follow limits (PT429 with a retry time, per-user budgets, edits not limited, window reset, configurable), and account deletion (recent sign-in and confirmation enforced in SQL, immediate removal, session ending, report anonymisation, queue privacy, ordering and retry bookkeeping). The harness stubs `auth.jwt()` the same way Supabase defines it. A passing local engine test does not verify a hosted project's PostgREST exposure, API grants outside these migrations, Auth configuration, or concurrent multi-connection scheduling. Inspect Supabase security advisors and smoke-test the APIs after deploying.

This change is a database foundation. Movie search and selection are wired to the minimal movie cache; ranking and social forms remain future work. TMDB ingestion excludes adult movies. Release-date validation for future ranking writes remains to be implemented because this minimal cache does not store complete release metadata. Comments/likes, notifications and taste calculations remain subsequent implementation work. Comment tombstones for deleted accounts will be needed once comments exist. Do not treat these core migrations as completion of every feature in SPEC.md.
