# CodeBox Movies database

Three ordered Supabase SQL migrations implement the requested core tables, RLS, constrained writes, and feed automation. They have **not** been applied to a hosted project.

## Apply

Preferred workflow with the Supabase CLI, from this repository:

```sh
npx supabase init
npx supabase start
# Local, disposable database only: reset recreates local data and applies migrations.
npx supabase db reset
```

`init` creates the local CLI configuration; it does not create hosted resources. A Docker-compatible runtime is required for the local Supabase stack. Keep `codebox_private` out of the API's exposed schemas.

When ready to apply to your own hosted project, inspect the SQL first and use:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Alternatively, run the contents of all three migration files in the Supabase SQL Editor, in timestamp order, as the database administrator. Do not then reapply the same migrations through the CLI without first reconciling its migration history. No secrets belong in SQL files. Never run the test fixture on a live database.

Files:

1. `supabase/migrations/20260929000100_core_tables.sql`: tables, enums, constraints, indexes, RLS enabled, explicit revocation of default client grants.
2. `supabase/migrations/20260929000200_access_and_activity.sql`: policies, safe projections, lifecycle triggers, and follow RPCs. Also backfills profiles and watchlists for existing Auth users.

3. `supabase/migrations/20260929000300_movie_request_limits.sql`: private request counters and a service-role-only quota RPC for movie search and selection.

Selection uses `POST /api/movies/cache` with only a TMDB ID. After checking session, verified email, origin, and quota, the server fetches trusted TMDB metadata and performs an idempotent service-role upsert. Browser clients still have no direct movie mutation grants.

Each migration is transactional and intended to run once through migration tracking. The first leaves tables inaccessible to clients until the second completes. SQL intentionally fails on conflicting existing tables instead of silently overwriting a different schema. Use forward migrations for later changes; rolling these tables back would destroy application data.

## Schema decisions

| Table        | Meaning                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`      | `id` references `auth.users`; username, avatar object path, `profile` JSON with only display_name/bio, visibility, timestamps. No email/password copies.                                    |
| `movies`     | `tmdb_id` primary key; cached title, poster path, year, cached_at. No full TMDB JSON, cast, or synopsis copies.                                                                             |
| `rankings`   | An editable watch/review entry: user_id, movie_id, bucket, position, score, note, watched_date; plus optional half-star opinion, spoiler flag, watched flag, timezone, version, timestamps. |
| `follows`    | Unique directional pair using the requested `follower_id` / `following_id` names; status pending/accepted/declined and timestamps. Mutual accepted rows imply friendship.                   |
| `lists`      | One automatically provisioned watchlist per user, plus owner-created custom lists. Both inherit profile visibility.                                                                         |
| `list_items` | Movies belonging to a list; unique list/movie pair, optional ordering position, added_at.                                                                                                   |
| `activity`   | One structured event per ranking entry. Clients cannot fabricate feed rows.                                                                                                                 |
| `blocks`     | Supporting table for the SPEC's bidirectional block filtering and removal of follow relationships.                                                                                          |

### Rankings, repeat watches, and stars

The requested `9.1` example is a decimal **ranking score from 0.0 to 10.0**. It is independent of the original SPEC's optional 1–5 half-star opinion (`star_half_units` 2–10). No arbitrary algorithm converts between the two. A decimal score requires a `liked`, `fine`, or `disliked` bucket; bucket and position are absent for entries without a decimal score. Numeric(3,1) stores one decimal place. No score thresholds are imposed on buckets: the future ranking workflow will choose them.

A ranking row represents a diary/review entry, allowing repeat watches of the same movie. Do not add a unique `(user_id, movie_id)` constraint: that would discard the SPEC's history. `position` is an optional positive placement snapshot on this entry, not a unique global movie order or a user-created custom ranked list. Custom lists are separately stored in `lists`/`list_items`; visitors can independently sort a profile collection. This schema does not implement a pairwise ranking algorithm or automatic reordering.

`current_rankings` selects one **scored** entry per user/movie, ordered by known watch date descending, then created_at and UUID descending. Known dates beat unknown dates. A later unrated watch does not erase a score; deleting the current entry reveals the previous eligible one. A scored entry has a decimal score and/or half-star opinion; if the latest scored entry omits one scale, that scale is NULL rather than carried forward from a different entry. `public_current_ratings` exposes just the public scoring fields with the same precedence, without dates or positions.

`watched_date = NULL` means unknown for a watched entry, and is required for an unwatched entry. The UI should supply local today and its IANA `watched_timezone`; the database checks that the date is not in the future in that timezone. SQL defaults to unknown date and UTC when these values are omitted. Watched-only entries and note-only entries are allowed; an entirely empty unwatched entry is rejected.

Saving an entry with `watched = true` removes that user's movie from their watchlist in the same transaction. Rating without watching preserves the watchlist. Re-adding a watched movie later is allowed. Deleting or unmarking a watch never recreates watchlist items. Notes are trimmed to NULL if blank and limited to 5,000 characters.

Persist a client-generated UUID across retries and supply it as the ranking `id`; a duplicate request cannot create another row with the same ID. For stale-edit protection, constrain an update by both `id` and the previously read `version`; zero returned rows means the entry changed or is inaccessible. Successful updates increment version automatically. Identity, author, movie, creation time, and version cannot be forged with client column writes.

### Privacy and public projections

`users`, raw `rankings`, lists, and list contents use profile visibility: public / followers / friends / private. Owners always have access. Followers require an accepted inbound follow; friends require accepted follows in both directions. An ordinary private-profile user cannot make all their reviews private: public review content is intentionally still public, as specified.

Read `user_identities` for public username/avatar, and `public_reviews` for public scoring/note/spoiler fields. These intentionally use narrow security-barrier definer views because public reviews must remain readable even when raw private diaries are not. **Never add private columns to these views.** They explicitly filter blocked authors. Other views use invoker security and underlying RLS. Public projections have SELECT-only grants.

Public views omit watched status, watch date, timezone, placement, and private profile JSON. `public_reviews` includes the spoiler flag and full note for explicit reveal; the UI must conceal flagged text and avoid embedding it into metadata or previews. `activity_feed` never includes any note text. A public rating can still reveal that someone has an opinion about a movie; privacy is not anonymity.

The current-rating views are viewer-filtered for blocks. A future global average must use a separate trusted aggregate that counts one eligible rating per user without changing according to the current viewer's blocks; do not derive a global total from this viewer-filtered response.

## Client permissions

- Guests: read movies, accessible profiles/collections/lists, public identities/reviews, and permitted activity. No mutation grants.
- Authenticated users: select an immutable username, update their own avatar/profile/privacy; create/edit/delete **only their own** rankings and custom lists; manage only their own list items and blocks.
- Ranking/list/social contributions additionally require a confirmed email and an onboarded username. The check reads `auth.users`, not editable user metadata.
- Clients cannot mutate movie cache data, feed events, author IDs, creation timestamps, or follow status directly.
- `service_role`: trusted database access, bypassing RLS as Supabase intends. Only server-side TMDB cache refresh and future administrative operations should use it. Never put it in `NEXT_PUBLIC_*`.

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
  .from("rankings")
  .insert({
    id: entryId,
    movie_id: 693134, // Must already exist in the minimal cache.
    bucket: "liked",
    position: 1,
    score: 9.1,
    star_half_units: 8, // Optional, separate 4-star opinion.
    note: "Beautiful film.",
    watched: true,
    watched_date: "2026-09-29", // UI supplies local today, or NULL for unknown.
    watched_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  .select()
  .single(); // user_id defaults to auth.uid(). Handle error explicitly.

// Stale edits return no rows when the expected version no longer matches.
await supabase
  .from("rankings")
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

For a Community feed, include only `ranked`/`reviewed` events. For Following, filter actors by the viewer's accepted outbound follows; RLS still rechecks each event. Cursor pagination should use `(created_at, id)`; relevant indexes are provided. Editing an entry updates its displayed score without adding a second event or bumping publication time.

`request_follow` accepts public targets immediately and creates pending requests for restricted targets. Only the recipient can approve or decline. A decline has a 24-hour retry cooldown; removing or blocking/unblocking a declined relationship does not erase it. Follow and block operations serialize by user pair to avoid approval/block races. Blocking removes pending and accepted follows in both directions; unblocking does not restore them. Public content remains readable when signed out.

## Tests and scope

```sh
npm run test:db
```

The test runner applies all three migrations to an isolated PGlite PostgreSQL engine and executes real SQL under `anon`, `authenticated`, and trusted roles. Only Supabase's auth schema/identity function are emulated. It needs no keys, network database, Supabase CLI, or Docker. The fixture is `supabase/tests/core.sql`; it creates synthetic users and is **not** a production migration or a pgTAP suite.

Coverage includes ownership attacks, direct-table writes, verified-email gating, projection leaks, profile visibility, follow approval/cooldown, blocking, constrained scores/dates, default watchlists, list ownership, history selection, feed updates/deletion, and Auth cascade cleanup. A passing local engine test does not verify a hosted project's PostgREST exposure, API grants outside these migrations, Auth configuration, or concurrent multi-connection scheduling. Inspect Supabase security advisors and smoke-test the APIs after deploying.

This change is a database foundation. Movie search and selection are wired to the minimal movie cache; ranking and social forms remain future work. TMDB ingestion excludes adult movies. Release-date validation for future ranking writes remains to be implemented because this minimal cache does not store complete release metadata. Avatar bucket policies and image processing, username onboarding UI, moderation/suspension, comments/likes, notifications, taste calculations, account-deletion orchestration remain subsequent implementation work. Do not treat these core migrations as completion of every feature in SPEC.md.
