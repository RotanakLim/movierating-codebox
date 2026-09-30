-- LOCAL ONLY. Bulk data for EXPLAIN ANALYZE runs (supabase/perf/explain.sql).
-- Never run against a hosted project: it creates thousands of fake accounts.
--   docker exec -i supabase_db_<project> psql -U postgres < supabase/perf/seed.sql
-- Shape: 5,000 users (10% private, 10% followers-only), 2,000 movies,
-- ~100,000 entries spread over two years, ~50 follows per user, and busy
-- reviews with comments, replies and likes. perf_0001 is the measured viewer.
\set ON_ERROR_STOP on
begin;
select setseed(0.42);

-- Seeding writes created_at directly and bypasses the per-user entry limit.
alter table public.entries disable trigger entries_guard;
alter table public.entries disable trigger entries_rate_limit;
alter table public.review_comments disable trigger review_comments_guard;

insert into public.movies(tmdb_id, title, year)
select 900000 + g, 'Perf movie ' || g, 1950 + g % 75 from generate_series(1, 2000) g
on conflict do nothing;

-- Token columns are '' rather than NULL, which Supabase Auth expects.
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  format('perf_%s@example.com', lpad(g::text, 4, '0')), '', now(), now(), now(), '', '', '', '', '', '', '', ''
from generate_series(1, 5000) g;

update public.users u
set username = split_part(a.email, '@', 1),
    visibility = case when random() < 0.1 then 'private' when random() < 0.1 then 'followers' else 'public' end::public.profile_visibility
from auth.users a
where a.id = u.id and a.email like 'perf\_%@example.com';

create temporary table perf_users on commit drop as
select u.id, row_number() over (order by u.username) as n
from public.users u where u.username like 'perf\_%';

-- ~20 entries per user, one per movie, created over the last two years.
insert into public.entries(user_id, movie_id, score, note, spoiler, watched, watched_date, created_at, updated_at)
select p.id, m.movie, s.score,
  case when random() < 0.3 then 'A seeded review of movie ' || m.movie end,
  random() < 0.05, true, null, t.at, t.at
from perf_users p
cross join lateral (
  select distinct 900001 + floor(random() * 2000)::int as movie
  from generate_series(1, 20) where p.id is not null
) m
cross join lateral (select case when random() < 0.8 then round((random() * 10)::numeric, 1) end as score) s
cross join lateral (select now() - random() * interval '730 days' as at) t;

-- Activity follows the entry's created_at (the sync trigger copies it).
update public.activity a set created_at = e.created_at from public.entries e
where e.id = a.entry_id and a.created_at <> e.created_at;

-- ~50 accepted follows per user, a few pending.
insert into public.follows(follower_id, following_id, status)
select a.id, b.id, case when random() < 0.05 then 'pending' else 'accepted' end::public.follow_status
from perf_users a
cross join lateral (
  select distinct 1 + floor(random() * 5000)::int as n from generate_series(1, 50) where a.id is not null
) pick
join perf_users b on b.n = pick.n and b.id <> a.id
on conflict do nothing;

-- A few busy reviews: 300 comments each, a third with replies, plus likes.
create temporary table perf_busy on commit drop as
select e.id from public.entries e join perf_users p on p.id = e.user_id
where e.note is not null order by e.created_at desc limit 20;

insert into public.review_comments(entry_id, user_id, body, created_at)
select b.id, p.id, 'Seeded comment ' || g, now() - (g || ' minutes')::interval
from perf_busy b cross join generate_series(1, 300) g
join perf_users p on p.n = 1 + (g * 17) % 5000;

insert into public.review_comments(entry_id, user_id, parent_id, body, created_at)
select c.entry_id, p.id, c.id, 'Seeded reply', c.created_at + interval '1 minute'
from public.review_comments c
join perf_users p on p.n = 1 + (abs(hashtext(c.id::text)) % 5000)
where c.entry_id in (select id from perf_busy) and c.parent_id is null and random() < 0.33;

insert into public.review_likes(entry_id, user_id)
select b.id, p.id from perf_busy b join perf_users p on p.n <= 800
on conflict do nothing;

alter table public.entries enable trigger entries_guard;
alter table public.entries enable trigger entries_rate_limit;
alter table public.review_comments enable trigger review_comments_guard;
commit;

analyze public.users, public.movies, public.entries, public.activity, public.follows,
  public.review_comments, public.review_likes, public.notifications, public.blocks;
select (select count(*) from public.users) users, (select count(*) from public.entries) entries,
  (select count(*) from public.follows) follows, (select count(*) from public.review_comments) comments,
  (select count(*) from public.notifications) notifications;
