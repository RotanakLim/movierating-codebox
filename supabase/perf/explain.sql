-- LOCAL ONLY, after supabase/perf/seed.sql. Runs the app's RLS-heavy reads as
-- perf_0001 (role authenticated, with its JWT claims) and prints the plans:
--   docker exec -i supabase_db_<project> psql -U postgres < supabase/perf/explain.sql
-- The queries mirror what PostgREST sends for src/lib/feed/load.ts,
-- src/lib/reviews/load.ts, src/lib/reviews/discussion.ts and the inbox.
\set ON_ERROR_STOP on
select set_config('perf.viewer', (select id::text from public.users where username = 'perf_0001'), false);
select set_config('perf.review', (
  select e.id::text from public.entries e join public.review_comments c on c.entry_id = e.id
  group by e.id order by count(*) desc limit 1), false);
select set_config('perf.movie', (
  select movie_id::text from public.entries group by movie_id order by count(*) desc limit 1), false);

begin;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('perf.viewer'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('perf.viewer'), true);
set local role authenticated;

\echo '== Following feed, first page'
explain (analyze, buffers, costs off, summary on)
select id, entry_id, kind, created_at, user_id, username, avatar, movie_id, title, poster, year, score
from public.following_feed order by created_at desc, id desc limit 21;

\echo '== Community feed, first page'
explain (analyze, buffers, costs off, summary on)
select id, entry_id, kind, created_at, user_id, username, avatar, movie_id, title, poster, year, score
from public.activity_feed where kind in ('rated', 'reviewed')
order by created_at desc, id desc limit 21;

\echo '== Community feed, deep cursor page'
explain (analyze, buffers, costs off, summary on)
select id from public.activity_feed where kind in ('rated', 'reviewed')
  and (created_at < now() - interval '400 days')
order by created_at desc, id desc limit 21;

\echo '== Movie reviews list (busiest movie)'
explain (analyze, buffers, costs off, summary on)
select id, user_id, score, note, spoiler, created_at, updated_at
from public.public_reviews where movie_id = current_setting('perf.movie')::bigint
order by created_at desc, id desc limit 21;

\echo '== Review threads (busiest review)'
explain (analyze, buffers, costs off, summary on)
select * from public.review_threads(current_setting('perf.review')::uuid, null, null, 20, 3);

\echo '== Inbox first page and unread count'
explain (analyze, buffers, costs off, summary on)
select * from public.my_notifications(null, null, 20);
explain (analyze, buffers, costs off, summary on)
select public.my_unread_notification_count();
rollback;
