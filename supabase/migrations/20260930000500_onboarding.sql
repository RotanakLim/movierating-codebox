-- Onboarding: username availability, favorite genres, and up to five favorite movies.
-- Favorites are private preferences. They never create rankings, activity, or watch logs.
begin;

-- Single source of truth for username rules, shared by the constraint and the RPC.
-- src/lib/onboarding/username.ts mirrors this list; a unit test keeps them in sync.
create function codebox_private.valid_username(candidate text)
returns boolean language sql immutable set search_path = '' as $$
  select candidate ~ '^[a-z0-9_]{3,24}$'
    and candidate not in ('admin', 'account', 'auth', 'api', 'about', 'discover',
      'movies', 'reviews', 'people', 'settings', 'notifications', 'onboarding',
      'me', 'u', 'support', 'codebox');
$$;
revoke all on function codebox_private.valid_username(text) from public;
-- Evaluating the check constraint requires EXECUTE for the writing role.
grant execute on function codebox_private.valid_username(text) to anon, authenticated, service_role;

alter table public.users drop constraint users_username_format;
alter table public.users add constraint users_username_format
  check (username is null or codebox_private.valid_username(username));

-- Availability for the onboarding form. Definer rights so private or blocking users'
-- names still count as taken; usernames are public, so this reveals nothing new.
create function public.username_status(candidate text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare normalized text := lower(btrim(coalesce(candidate, '')));
begin
  if auth.uid() is null then
    raise exception 'Sign in to choose a username' using errcode = '42501';
  end if;
  if normalized !~ '^[a-z0-9_]{3,24}$' then return 'invalid'; end if;
  if not codebox_private.valid_username(normalized) then return 'reserved'; end if;
  if exists (select 1 from public.users u where u.username = normalized) then return 'taken'; end if;
  return 'available';
end;
$$;
revoke all on function public.username_status(text) from public, anon, authenticated;
grant execute on function public.username_status(text) to authenticated;

create table public.user_preferences (
  user_id uuid primary key default auth.uid() references public.users(id) on delete cascade,
  -- TMDB movie genre IDs (src/lib/movies/types.ts MOVIE_GENRES).
  favorite_genre_ids integer[] not null default '{}' check (
    array_position(favorite_genre_ids, null) is null
    and favorite_genre_ids <@ array[28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27,
      10402, 9648, 10749, 878, 10770, 53, 10752, 37]
  ),
  updated_at timestamptz not null default now()
);
comment on table public.user_preferences is 'Owner-only onboarding/settings preferences. Never used to fabricate ratings or watch logs.';

create function codebox_private.guard_user_preferences()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Preference owner is immutable' using errcode = '23514';
  end if;
  new.favorite_genre_ids := array(
    select distinct g from unnest(new.favorite_genre_ids) g order by g
  );
  new.updated_at := now();
  return new;
end;
$$;
create trigger user_preferences_guard before insert or update on public.user_preferences
for each row execute function codebox_private.guard_user_preferences();

create table public.user_favorite_movies (
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  movie_id bigint not null references public.movies(tmdb_id) on delete restrict,
  -- Display order is the order the user picked them in; there is no manual ranking.
  added_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);
create index user_favorite_movies_movie on public.user_favorite_movies(movie_id);
comment on table public.user_favorite_movies is 'Up to five owner-only favorite movies. Never creates rankings, activity, or watch logs.';

create function codebox_private.limit_favorite_movies()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Serialize per user so concurrent inserts cannot exceed the limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('favorites:' || new.user_id::text, 0));
  if (select count(*) from public.user_favorite_movies f where f.user_id = new.user_id) >= 5 then
    raise exception 'Choose up to five favorite movies' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger user_favorite_movies_limit before insert on public.user_favorite_movies
for each row execute function codebox_private.limit_favorite_movies();

-- Replace the caller's favorites atomically. Invoker rights: RLS still applies.
create function public.set_favorite_movies(movie_ids bigint[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to save favorites' using errcode = '42501';
  end if;
  if movie_ids is null or cardinality(movie_ids) > 5
     or array_position(movie_ids, null) is not null
     or cardinality(movie_ids) <> (select count(distinct m) from unnest(movie_ids) m) then
    raise exception 'Choose up to five different movies' using errcode = '22023';
  end if;
  delete from public.user_favorite_movies where user_id = auth.uid();
  insert into public.user_favorite_movies(user_id, movie_id, added_at)
  select auth.uid(), m.id, now() + (m.ord * interval '1 microsecond')
  from unnest(movie_ids) with ordinality as m(id, ord);
end;
$$;
revoke all on function public.set_favorite_movies(bigint[]) from public, anon, authenticated;
grant execute on function public.set_favorite_movies(bigint[]) to authenticated;

revoke all on function codebox_private.guard_user_preferences(),
  codebox_private.limit_favorite_movies() from public, anon, authenticated;

alter table public.user_preferences enable row level security;
alter table public.user_favorite_movies enable row level security;

create policy user_preferences_owner_read on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_preferences_owner_insert on public.user_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_preferences_owner_update on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy user_preferences_owner_delete on public.user_preferences for delete to authenticated
  using (user_id = (select auth.uid()));

create policy user_favorite_movies_owner_read on public.user_favorite_movies for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_favorite_movies_owner_insert on public.user_favorite_movies for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_favorite_movies_owner_delete on public.user_favorite_movies for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_preferences, public.user_favorite_movies from public, anon, authenticated;
grant select, insert, update, delete on public.user_preferences, public.user_favorite_movies to service_role;
grant select, delete on public.user_preferences, public.user_favorite_movies to authenticated;
grant insert (user_id, favorite_genre_ids), update (favorite_genre_ids)
  on public.user_preferences to authenticated;
grant insert (user_id, movie_id, added_at) on public.user_favorite_movies to authenticated;

commit;
