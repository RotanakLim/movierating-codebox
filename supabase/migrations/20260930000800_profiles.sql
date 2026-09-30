-- Owner collections, public profile lookups, and user reports.
begin;

-- One row per (user, movie): the current score (current_entries precedence), the
-- last known watch date and the watch count. security_invoker: entries RLS applies,
-- so a viewer only ever sees collections of profiles they may access.
create view public.user_movie_collection with (security_invoker = true) as
  select e.user_id, e.movie_id, m.title, m.poster, m.year,
    (array_agg(e.score order by e.watched_date desc nulls last, e.created_at desc, e.id desc)
      filter (where e.score is not null))[1] as current_score,
    max(e.watched_date) filter (where e.watched) as last_watched_date,
    (count(*) filter (where e.watched))::integer as watch_count
  from public.entries e
  join public.movies m on m.tmdb_id = e.movie_id
  group by e.user_id, e.movie_id, m.title, m.poster, m.year;
revoke all on public.user_movie_collection from public, anon, authenticated;
grant select on public.user_movie_collection to anon, authenticated, service_role;

-- Diary: a user's watched entries, newest known date first.
create index entries_user_diary on public.entries
  (user_id, watched_date desc nulls last, created_at desc, id desc) where watched;

-- Profile page lookup. users RLS hides restricted profiles entirely, so the
-- restricted shell needs this narrow definer function. It returns only what the
-- shell may show (username, avatar, privacy mode) plus the viewer's own
-- relationship. A profile whose owner blocked the viewer reports only 'unavailable'.
create function public.profile_card(target_username text)
returns table (
  id uuid, username text, avatar text, visibility public.profile_visibility,
  can_view boolean, relationship text, follow_status public.follow_status
)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); target public.users%rowtype;
begin
  select * into target from public.users u
  where u.username = lower(btrim(target_username)) and u.username is not null;
  if not found then return; end if;
  if me is not null and exists (
    select 1 from public.blocks b where b.blocker_id = target.id and b.blocked_id = me
  ) then
    return query select target.id, target.username, null::text, null::public.profile_visibility,
      false, 'unavailable'::text, null::public.follow_status;
    return;
  end if;
  return query select target.id, target.username, target.avatar, target.visibility,
    codebox_private.can_view_profile(target.id),
    case
      when me = target.id then 'self'
      when me is not null and exists (
        select 1 from public.blocks b where b.blocker_id = me and b.blocked_id = target.id
      ) then 'blocked'
      else 'none'
    end,
    (select f.status from public.follows f where f.follower_id = me and f.following_id = target.id);
end;
$$;
revoke all on function public.profile_card(text) from public;
grant execute on function public.profile_card(text) to anon, authenticated, service_role;

-- The caller's own block list with usernames for Settings. user_identities hides
-- blocked accounts from both sides, so the blocker needs this owner-only lookup.
create function public.my_blocked_users()
returns table (id uuid, username text, avatar text, blocked_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, u.username, u.avatar, b.created_at
  from public.blocks b join public.users u on u.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;
revoke all on function public.my_blocked_users() from public, anon;
grant execute on function public.my_blocked_users() to authenticated, service_role;

-- Reports: verified users report other users. Only admins may read them (no admin
-- role exists yet, so no client can); the reporter gets a receipt from the insert.
create type public.report_reason as enum
  ('spam', 'harassment', 'inappropriate', 'spoilers', 'other');
create type public.report_status as enum ('open', 'resolved', 'dismissed');
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  target_user_id uuid not null references public.users(id) on delete cascade,
  reason public.report_reason not null,
  details text check (details is null or char_length(details) <= 1000),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  check (reporter_id <> target_user_id)
);
comment on table public.reports is 'User reports. Identities and details are admin-only; the reported user never sees them.';
create unique index reports_one_open_per_target on public.reports(reporter_id, target_user_id)
  where status = 'open';
alter table public.reports enable row level security;
create policy reports_insert_self on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and (select codebox_private.can_contribute())
    and status = 'open');
revoke all on public.reports from public, anon, authenticated;
grant insert (id, reporter_id, target_user_id, reason, details) on public.reports to authenticated;
grant select, insert, update, delete on public.reports to service_role;

commit;
