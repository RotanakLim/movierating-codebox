-- Feed and RLS performance, measured with supabase/perf/seed.sql (5,000 users,
-- ~100,000 entries) and supabase/perf/explain.sql on the local Supabase stack
-- (PostgreSQL 17), September 2026. No behavior changes.
--
-- 1. can_view_profile and can_view_activity run once per row in RLS policies,
--    and comment_state once per comment in review_threads. As non-inlinable SQL
--    functions they were re-planned on every call (~130-160 µs each); plpgsql
--    caches its plans (~15-20 µs). Same rules, same answers:
--    supabase/tests/core.sql covers the privacy matrix and comment states.
-- 2. activity_feed joined the security_barrier views user_identities and
--    public_reviews. A join key can't be pushed into a security_barrier view,
--    so every page built the whole of public_reviews (~1.4 s). LATERAL lookups
--    fenced with OFFSET 0 keep the key as a leakproof uuid equality the view
--    can use for an index scan, so a page reads only the rows it returns.
begin;

create or replace function codebox_private.can_view_profile(owner_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  owner_visibility public.profile_visibility;
begin
  select u.visibility into owner_visibility from public.users u where u.id = owner_id;
  if not found or not codebox_private.not_blocked(owner_id) then return false; end if;
  if owner_id = viewer or owner_visibility = 'public' then return true; end if;
  if viewer is null or owner_visibility not in ('followers', 'friends') then return false; end if;
  if not exists (
    select 1 from public.follows f where f.follower_id = viewer
      and f.following_id = owner_id and f.status = 'accepted'
  ) then return false; end if;
  -- Friends: the follow must be mutual.
  return owner_visibility = 'followers' or exists (
    select 1 from public.follows f where f.follower_id = owner_id
      and f.following_id = viewer and f.status = 'accepted'
  );
end;
$$;

create or replace function codebox_private.can_view_activity(entry_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  author uuid;
  rated_or_reviewed boolean;
begin
  select e.user_id, (e.score is not null or e.note is not null) into author, rated_or_reviewed
  from public.entries e where e.id = entry_id;
  if not found or not codebox_private.not_blocked(author) then return false; end if;
  if author is distinct from auth.uid()
     and not codebox_private.entry_is_public(entry_id, author) then return false; end if;
  -- Ratings and reviews are public; watched-only activity follows profile privacy.
  return rated_or_reviewed or codebox_private.can_view_profile(author);
end;
$$;

create or replace function codebox_private.comment_state(target public.review_comments)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if target.deleted_at is not null then return 'deleted'; end if;
  if exists (select 1 from codebox_private.hidden_comments h where h.comment_id = target.id)
    then return 'removed'; end if;
  if target.user_id is not null and codebox_private.is_suspended(target.user_id)
    then return 'removed'; end if;
  if target.user_id is not null and not codebox_private.not_blocked(target.user_id)
    then return 'blocked'; end if;
  return 'visible';
end;
$$;

create or replace view public.activity_feed with (security_invoker = true) as
select a.id, a.user_id, a.movie_id, a.entry_id, a.kind, a.created_at,
  u.username, u.avatar, m.title, m.poster, m.year, r.score,
  case
    when a.kind = 'rated' then u.username || ' rated ' || m.title || ' ' || r.score::numeric(3,1)::text || '/10'
    when a.kind = 'reviewed' then u.username || ' reviewed ' || m.title
    else u.username || ' watched ' || m.title
  end as summary
from public.activity a
cross join lateral (
  select i.username, i.avatar from public.user_identities i where i.id = a.user_id offset 0
) u
join public.movies m on m.tmdb_id = a.movie_id
left join lateral (
  select p.score from public.public_reviews p where p.id = a.entry_id offset 0
) r on true;

commit;
