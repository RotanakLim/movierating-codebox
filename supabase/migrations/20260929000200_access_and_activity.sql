begin;

-- Security-definer helpers prevent recursive RLS lookups. They always derive the
-- viewer from auth.uid(), use qualified objects, and have a fixed empty search_path.
create function codebox_private.not_blocked(owner_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.blocks b where
      (b.blocker_id = auth.uid() and b.blocked_id = owner_id)
      or (b.blocker_id = owner_id and b.blocked_id = auth.uid())
  );
$$;

create function codebox_private.can_contribute()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users a join public.users p on p.id = a.id
    where a.id = auth.uid() and a.email_confirmed_at is not null and p.username is not null
  );
$$;

create function codebox_private.can_view_profile(owner_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.id = owner_id and codebox_private.not_blocked(u.id) and (
      u.id = auth.uid()
      or u.visibility = 'public'
      or (u.visibility in ('followers', 'friends') and exists (
        select 1 from public.follows f where f.follower_id = auth.uid()
        and f.following_id = u.id and f.status = 'accepted'
      ) and (u.visibility = 'followers' or exists (
        select 1 from public.follows f where f.follower_id = u.id
        and f.following_id = auth.uid() and f.status = 'accepted'
      )))
    )
  );
$$;

create function codebox_private.can_view_activity(entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rankings r where r.id = entry_id
    and codebox_private.not_blocked(r.user_id)
    and (r.score is not null or r.star_half_units is not null or r.note is not null
      or codebox_private.can_view_profile(r.user_id))
  );
$$;

create function codebox_private.lock_pair(a uuid, b uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(least(a::text, b::text) || ':' || greatest(a::text, b::text), 0)
  );
$$;

create function codebox_private.guard_user()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.username is not null then new.username := lower(btrim(new.username)); end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
      raise exception 'Identity and creation time are immutable' using errcode = '23514';
    end if;
    if old.username is not null and new.username is distinct from old.username then
      raise exception 'Username cannot be changed after onboarding' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger users_guard before insert or update on public.users
for each row execute function codebox_private.guard_user();

create function codebox_private.guard_ranking()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.note := nullif(btrim(new.note), '');
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.watched_timezone) then
    raise exception 'Invalid watch timezone' using errcode = '23514';
  end if;
  if new.watched_date > (now() at time zone new.watched_timezone)::date then
    raise exception 'Watch date cannot be in the future' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id
       or new.movie_id is distinct from old.movie_id or new.created_at is distinct from old.created_at then
      raise exception 'Ranking identity, owner, movie and creation time are immutable' using errcode = '23514';
    end if;
    new.version := old.version + 1;
  else
    new.version := 1;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger rankings_guard before insert or update on public.rankings
for each row execute function codebox_private.guard_ranking();

create function codebox_private.guard_list()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id or new.user_id is distinct from old.user_id
    or new.kind is distinct from old.kind or new.created_at is distinct from old.created_at
  ) then
    raise exception 'List identity, owner and kind are immutable' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger lists_guard before insert or update on public.lists
for each row execute function codebox_private.guard_list();

create function codebox_private.create_watchlist()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.lists(user_id, kind, name) values (new.id, 'watchlist', 'Watchlist');
  return new;
end;
$$;
create trigger users_create_watchlist after insert on public.users
for each row execute function codebox_private.create_watchlist();

create function codebox_private.handle_auth_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Do not trust raw_user_meta_data for permissions or claim an unchosen username.
  insert into public.users(id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
create trigger codebox_auth_signup after insert on auth.users
for each row execute function codebox_private.handle_auth_signup();

create function codebox_private.sync_ranking_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_kind public.activity_kind;
begin
  event_kind := case
    when new.score is not null or new.star_half_units is not null then 'ranked'::public.activity_kind
    when new.note is not null then 'reviewed'::public.activity_kind
    else 'watched'::public.activity_kind end;
  insert into public.activity(user_id, movie_id, ranking_id, kind, created_at)
  values (new.user_id, new.movie_id, new.id, event_kind, new.created_at)
  on conflict (ranking_id) do update set kind = excluded.kind;
  -- Edits never bump activity.created_at; deletes cascade via ranking_id.
  if new.watched then
    delete from public.list_items i using public.lists l
    where i.list_id = l.id and l.user_id = new.user_id
      and l.kind = 'watchlist' and i.movie_id = new.movie_id;
  end if;
  return new;
end;
$$;
create trigger rankings_sync_activity after insert or update on public.rankings
for each row execute function codebox_private.sync_ranking_activity();

create function codebox_private.apply_block()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform codebox_private.lock_pair(new.blocker_id, new.blocked_id);
  delete from public.follows where status <> 'declined' and (
    (follower_id = new.blocker_id and following_id = new.blocked_id)
    or (follower_id = new.blocked_id and following_id = new.blocker_id)
  );
  return new;
end;
$$;
create trigger blocks_remove_relationships before insert on public.blocks
for each row execute function codebox_private.apply_block();

-- Followers never write status directly. These RPCs bind the actor to auth.uid().
create function public.request_follow(target_id uuid)
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
  desired := case when visibility = 'public' then 'accepted'::public.follow_status else 'pending'::public.follow_status end;
  insert into public.follows(follower_id, following_id, status) values (me, target_id, desired)
  on conflict (follower_id, following_id) do update set status = excluded.status, updated_at = now();
  return desired;
end;
$$;

create function public.respond_follow(requester_id uuid, approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not codebox_private.can_contribute() then
    raise exception 'Verified account and username required' using errcode = '42501';
  end if;
  if requester_id is null or approve is null then
    raise exception 'Requester and decision required' using errcode = '22023';
  end if;
  perform codebox_private.lock_pair(me, requester_id);
  if not codebox_private.not_blocked(requester_id) then
    raise exception 'Follow unavailable' using errcode = '42501';
  end if;
  update public.follows set status = case when approve then 'accepted'::public.follow_status else 'declined'::public.follow_status end,
    updated_at = now()
  where follower_id = requester_id and following_id = me and status = 'pending';
  if not found then raise exception 'Pending request not found' using errcode = '22023'; end if;
end;
$$;

create function public.remove_follow(other_id uuid, direction text default 'outgoing')
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if other_id is null or direction is null or direction not in ('outgoing', 'incoming') then
    raise exception 'Invalid relationship' using errcode = '22023';
  end if;
  perform codebox_private.lock_pair(me, other_id);
  -- Retain declined records so a requester cannot delete/reinsert around cooldown.
  delete from public.follows where status <> 'declined' and (
    (direction = 'outgoing' and follower_id = me and following_id = other_id)
    or (direction = 'incoming' and follower_id = other_id and following_id = me)
  );
end;
$$;

-- Users may see only accessible profiles. Public identity is exposed separately.
create policy users_read_profile on public.users for select to anon, authenticated
  using (codebox_private.can_view_profile(id));
create policy users_update_self on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy movies_read on public.movies for select to anon, authenticated using (true);
-- Movie writes are backend/service_role only; users cannot poison the shared cache.

create policy rankings_read_profile on public.rankings for select to anon, authenticated
  using (codebox_private.can_view_profile(user_id));
create policy rankings_insert_self on public.rankings for insert to authenticated
  with check (user_id = (select auth.uid()) and (select codebox_private.can_contribute()));
create policy rankings_update_self on public.rankings for update to authenticated
  using (user_id = (select auth.uid()) and (select codebox_private.can_contribute()))
  with check (user_id = (select auth.uid()) and (select codebox_private.can_contribute()));
create policy rankings_delete_self on public.rankings for delete to authenticated
  using (user_id = (select auth.uid()) and (select codebox_private.can_contribute()));

create policy follows_read on public.follows for select to anon, authenticated using (
  codebox_private.not_blocked(follower_id) and codebox_private.not_blocked(following_id) and (
    follower_id = (select auth.uid()) or following_id = (select auth.uid())
    or (status = 'accepted' and codebox_private.can_view_profile(follower_id)
      and codebox_private.can_view_profile(following_id))
  )
);
create policy blocks_read_self on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy blocks_insert_self on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()) and (select codebox_private.can_contribute()));
create policy blocks_delete_self on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

create policy lists_read_profile on public.lists for select to anon, authenticated
  using (codebox_private.can_view_profile(user_id));
create policy lists_insert_self on public.lists for insert to authenticated
  with check (user_id = (select auth.uid()) and (select codebox_private.can_contribute()) and kind = 'custom');
create policy lists_update_self on public.lists for update to authenticated
  using (user_id = (select auth.uid()) and (select codebox_private.can_contribute()))
  with check (user_id = (select auth.uid()) and (select codebox_private.can_contribute()));
create policy lists_delete_self on public.lists for delete to authenticated
  using (user_id = (select auth.uid()) and (select codebox_private.can_contribute()) and kind = 'custom');

create policy list_items_read_profile on public.list_items for select to anon, authenticated
  using (exists (select 1 from public.lists l where l.id = list_id));
create policy list_items_insert_self on public.list_items for insert to authenticated
  with check ((select codebox_private.can_contribute()) and exists (
    select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())
  ));
create policy list_items_update_self on public.list_items for update to authenticated
  using ((select codebox_private.can_contribute()) and exists (
    select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())
  )) with check ((select codebox_private.can_contribute()) and exists (
    select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())
  ));
create policy list_items_delete_self on public.list_items for delete to authenticated
  using ((select codebox_private.can_contribute()) and exists (
    select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())
  ));
create policy activity_read on public.activity for select to anon, authenticated
  using (codebox_private.can_view_activity(ranking_id));

-- Intentional definer projections: raw restricted profiles/diaries remain protected
-- by RLS. These narrowly selected columns are public even for private profiles.
-- security_barrier prevents caller predicates from running ahead of visibility filters.
-- No client receives INSERT/UPDATE/DELETE on any view.
create view public.user_identities with (security_barrier = true) as
  select u.id, u.username, u.avatar from public.users u
  where u.username is not null and codebox_private.not_blocked(u.id);

create view public.public_reviews with (security_barrier = true) as
  select r.id, r.user_id, r.movie_id, r.bucket, r.score, r.star_half_units,
    r.note, r.spoiler, r.created_at, r.updated_at
  from public.rankings r
  where (r.score is not null or r.star_half_units is not null or r.note is not null)
    and codebox_private.not_blocked(r.user_id);

create view public.current_rankings with (security_invoker = true) as
  select distinct on (r.user_id, r.movie_id) r.* from public.rankings r
  where r.score is not null or r.star_half_units is not null
  order by r.user_id, r.movie_id, r.watched_date desc nulls last, r.created_at desc, r.id desc;

create view public.public_current_ratings with (security_barrier = true) as
  select distinct on (r.user_id, r.movie_id)
    r.id, r.user_id, r.movie_id, r.bucket, r.score, r.star_half_units
  from public.rankings r
  where (r.score is not null or r.star_half_units is not null)
    and codebox_private.not_blocked(r.user_id)
  order by r.user_id, r.movie_id, r.watched_date desc nulls last, r.created_at desc, r.id desc;

create view public.activity_feed with (security_invoker = true) as
  select a.id, a.user_id, a.movie_id, a.ranking_id, a.kind, a.created_at,
    u.username, u.avatar, m.title, m.poster, m.year, r.score, r.star_half_units,
    case
      when a.kind = 'ranked' and r.score is not null then u.username || ' ranked ' || m.title || ' at ' || r.score::text
      when a.kind = 'ranked' then u.username || ' rated ' || m.title || ' ' || (r.star_half_units / 2.0)::numeric(2,1)::text || ' stars'
      when a.kind = 'reviewed' then u.username || ' reviewed ' || m.title
      else u.username || ' watched ' || m.title
    end as summary
  from public.activity a join public.user_identities u on u.id = a.user_id
  join public.movies m on m.tmdb_id = a.movie_id
  left join public.public_reviews r on r.id = a.ranking_id;

-- Lock down functions, including PostgreSQL's default PUBLIC EXECUTE grant.
revoke all on all functions in schema codebox_private from public, anon, authenticated;
grant usage on schema codebox_private to anon, authenticated, service_role;
grant execute on function codebox_private.not_blocked(uuid), codebox_private.can_view_profile(uuid),
  codebox_private.can_view_activity(uuid), codebox_private.can_contribute() to anon, authenticated, service_role;
revoke all on function public.request_follow(uuid), public.respond_follow(uuid, boolean),
  public.remove_follow(uuid, text) from public, anon, authenticated;
grant execute on function public.request_follow(uuid), public.respond_follow(uuid, boolean),
  public.remove_follow(uuid, text) to authenticated;

-- Explicit column grants also prevent ownership reassignment / timestamp forgery.
grant select on public.users, public.movies, public.rankings, public.follows,
  public.lists, public.list_items, public.activity to anon, authenticated;
grant update (username, avatar, profile, visibility) on public.users to authenticated;
grant insert (id, user_id, movie_id, bucket, position, score, star_half_units, note, spoiler,
  watched, watched_date, watched_timezone) on public.rankings to authenticated;
grant update (bucket, position, score, star_half_units, note, spoiler, watched, watched_date,
  watched_timezone) on public.rankings to authenticated;
grant delete on public.rankings to authenticated;
grant select, delete on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;
grant insert (id, user_id, kind, name, description) on public.lists to authenticated;
grant update (name, description) on public.lists to authenticated;
grant delete on public.lists to authenticated;
grant insert (list_id, movie_id, position) on public.list_items to authenticated;
grant update (position) on public.list_items to authenticated;
grant delete on public.list_items to authenticated;

revoke all on public.user_identities, public.public_reviews, public.current_rankings,
  public.public_current_ratings, public.activity_feed from public, anon, authenticated;
grant select on public.user_identities, public.public_reviews, public.current_rankings,
  public.public_current_ratings, public.activity_feed to anon, authenticated, service_role;

-- Existing email and Google users get the same safe onboarding shell as new users.
insert into public.users(id) select id from auth.users on conflict (id) do nothing;
insert into public.lists(user_id, kind, name)
  select u.id, 'watchlist', 'Watchlist' from public.users u
  where not exists (select 1 from public.lists l where l.user_id = u.id and l.kind = 'watchlist');

commit;
