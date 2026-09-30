-- Social UI support (SPEC section 8): the Following feed, people search and
-- discovery, and a persisted limit of 30 follow requests per hour.
begin;

-- Following feed: activity from people the viewer follows (accepted only).
-- security_invoker, so activity RLS (can_view_activity: blocks, hidden content,
-- suspensions, and profile access for watched-only events) still applies.
create view public.following_feed with (security_invoker = true) as
  select f.* from public.activity_feed f
  where exists (
    select 1 from public.follows fo
    where fo.follower_id = (select auth.uid()) and fo.following_id = f.user_id
      and fo.status = 'accepted'
  );
revoke all on public.following_feed from public, anon, authenticated;
grant select on public.following_feed to authenticated, service_role;

-- Community feed pages read public ratings/reviews newest first.
create index activity_public_recent on public.activity(created_at desc, id desc)
  where kind in ('rated', 'reviewed');

-- People search and discovery. Returns only what the restricted-profile shell may
-- show (username, avatar, privacy mode), plus the display name when the viewer may
-- see the profile, and the viewer's own follow status. Accounts either side has
-- blocked and suspended accounts are left out.
--   search given: usernames starting with it (any privacy mode).
--   search null:  public profiles, most recently active (public rating or review) first.
create function public.find_people(search text default null, max_rows integer default 24)
returns table (
  id uuid, username text, avatar text, visibility public.profile_visibility,
  display_name text, follow_status public.follow_status, last_active timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  term text := lower(btrim(coalesce(search, '')));
  size integer := greatest(1, least(coalesce(max_rows, 24), 50));
begin
  if term <> '' and term !~ '^[a-z0-9_]{1,24}$' then
    return;
  end if;
  return query
  with candidates as (
    select u.id, u.username, u.avatar, u.visibility, u.profile, u.created_at,
      (select max(a.created_at) from public.activity a
        where a.user_id = u.id and a.kind in ('rated', 'reviewed')) as last_active
    from public.users u
    where u.username is not null
      and (me is null or u.id <> me)
      and codebox_private.not_blocked(u.id)
      and not codebox_private.is_suspended(u.id)
      and (case when term = '' then u.visibility = 'public'
           else u.username like replace(term, '_', '\_') || '%' end)
  )
  select c.id, c.username, c.avatar, c.visibility,
    case when codebox_private.can_view_profile(c.id) then c.profile ->> 'display_name' end,
    (select f.status from public.follows f where f.follower_id = me and f.following_id = c.id),
    c.last_active
  from candidates c
  order by
    case when term <> '' and c.username = term then 0 else 1 end,
    case when term = '' then c.last_active end desc nulls last,
    case when term = '' then c.created_at end desc,
    c.username
  limit size;
end;
$$;
revoke all on function public.find_people(text, integer) from public;
grant execute on function public.find_people(text, integer) to anon, authenticated, service_role;

-- Follow requests: at most 30 per user per hour (configurable like the others).
-- Only new or renewed requests count; asking again about an existing follow doesn't.
alter table codebox_private.action_limit_settings
  drop constraint action_limit_settings_action_check,
  add constraint action_limit_settings_action_check
    check (action in ('entry', 'report', 'follow'));
insert into codebox_private.action_limit_settings values ('follow', 30, 3600);

create or replace function public.request_follow(target_id uuid)
returns public.follow_status language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); visibility public.profile_visibility;
  existing public.follows%rowtype; desired public.follow_status;
begin
  if not codebox_private.can_contribute() then
    raise exception 'Verified account and username required' using errcode = '42501';
  end if;
  if target_id is null or target_id = me then
    raise exception 'Invalid follow target' using errcode = '22023';
  end if;
  perform codebox_private.lock_pair(me, target_id);
  if not codebox_private.not_blocked(target_id) then
    raise exception 'Follow unavailable' using errcode = '42501';
  end if;
  select u.visibility into visibility from public.users u
    where u.id = target_id and u.username is not null for share;
  if not found then raise exception 'Follow target unavailable' using errcode = '22023'; end if;
  select * into existing from public.follows f where f.follower_id = me and f.following_id = target_id;
  if found then
    if existing.status <> 'declined' then return existing.status; end if;
    if existing.updated_at > now() - interval '24 hours' then
      raise exception 'Please wait 24 hours before requesting again' using errcode = '22023';
    end if;
  end if;
  perform codebox_private.consume_action_limit('follow');
  desired := case when visibility = 'public' then 'accepted'::public.follow_status else 'pending'::public.follow_status end;
  insert into public.follows(follower_id, following_id, status) values (me, target_id, desired)
  on conflict (follower_id, following_id) do update set status = excluded.status, updated_at = now();
  return desired;
end;
$$;

commit;
