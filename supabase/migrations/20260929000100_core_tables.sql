-- CodeBox Movies core data. Apply before 20260929000200_access_and_activity.sql.
-- This migration deliberately exposes no client access until policies are installed.
begin;

create schema if not exists codebox_private;
revoke all on schema codebox_private from public, anon, authenticated;

create type public.profile_visibility as enum ('public', 'followers', 'friends', 'private');
create type public.ranking_bucket as enum ('liked', 'fine', 'disliked');
create type public.follow_status as enum ('pending', 'accepted', 'declined');
create type public.list_kind as enum ('watchlist', 'custom');
create type public.activity_kind as enum ('ranked', 'reviewed', 'watched');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  -- NULL only until onboarding claims a unique username. Never copy email into a profile.
  username text unique,
  avatar text,
  profile jsonb not null default '{}'::jsonb,
  visibility public.profile_visibility not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_username_format check (
    username is null or (
      username ~ '^[a-z0-9_]{3,24}$'
      and username not in ('admin', 'account', 'auth', 'api', 'about', 'discover',
        'movies', 'reviews', 'people', 'settings', 'notifications', 'onboarding',
        'me', 'u', 'support', 'codebox')
    )
  ),
  -- Public avatar object path in a future avatars bucket: <auth UUID>/<file>.
  constraint users_avatar_path check (avatar is null or (
    char_length(avatar) <= 512
    and split_part(avatar, '/', 1) = id::text
    and avatar ~ '^[a-f0-9-]+/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$'
  )),
  constraint users_profile_shape check (
    jsonb_typeof(profile) = 'object'
    and (profile - 'display_name' - 'bio') = '{}'::jsonb
    and (not profile ? 'display_name' or (
      jsonb_typeof(profile -> 'display_name') = 'string'
      and char_length(profile ->> 'display_name') <= 60
    ))
    and (not profile ? 'bio' or (
      jsonb_typeof(profile -> 'bio') = 'string'
      and char_length(profile ->> 'bio') <= 300
    ))
  )
);

create table public.movies (
  tmdb_id bigint primary key check (tmdb_id > 0),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  poster text check (poster is null or (
    char_length(poster) <= 512 and poster ~ '^/[a-zA-Z0-9_.-]+$'
  )),
  year smallint check (year between 1800 and 2200),
  cached_at timestamptz not null default now()
);
comment on table public.movies is 'Minimal TMDB cache: title, poster path, year and cache timestamp. No full TMDB payload.';

create table public.rankings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  movie_id bigint not null references public.movies(tmdb_id) on delete restrict,
  bucket public.ranking_bucket,
  position integer check (position > 0),
  score numeric(3,1) check (score between 0 and 10),
  -- Original SPEC star opinion is distinct from the new continuous ranking score.
  star_half_units smallint check (star_half_units between 2 and 10),
  note text check (char_length(note) <= 5000),
  spoiler boolean not null default false,
  watched boolean not null default true,
  watched_date date,
  watched_timezone text not null default 'UTC',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rankings_score_bucket check (
    (score is null and bucket is null and position is null)
    or (score is not null and bucket is not null)
  ),
  constraint rankings_unwatched_date check (watched or watched_date is null),
  constraint rankings_content check (
    watched or score is not null or star_half_units is not null
    or coalesce(char_length(btrim(note)) > 0, false)
  ),
  constraint rankings_actor_movie_key unique (id, user_id, movie_id)
);
comment on table public.rankings is 'One editable diary/review entry, not a unique user/movie row. Rewatches preserve history; current_rankings selects the latest scored opinion.';
comment on column public.rankings.position is 'Optional positive placement snapshot for this scored entry, not a globally unique rank. Visitors may independently sort the current collection.';
comment on column public.rankings.score is 'Independent decimal ranking score, 0.0–10.0; no automatic bucket-to-score algorithm or star conversion.';
comment on column public.rankings.watched_date is 'NULL means unknown/unwatched. UI supplies local today by default; timezone validates future dates.';

create table public.follows (
  follower_id uuid not null references public.users(id) on delete cascade,
  following_id uuid not null references public.users(id) on delete cascade,
  status public.follow_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table public.blocks (
  blocker_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  kind public.list_kind not null default 'custom',
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'watchlist' or name = 'Watchlist')
);
create unique index lists_one_watchlist_per_user on public.lists(user_id) where kind = 'watchlist';

create table public.list_items (
  list_id uuid not null references public.lists(id) on delete cascade,
  movie_id bigint not null references public.movies(tmdb_id) on delete restrict,
  position integer check (position > 0),
  added_at timestamptz not null default now(),
  primary key (list_id, movie_id)
);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  movie_id bigint not null references public.movies(tmdb_id) on delete restrict,
  ranking_id uuid not null unique,
  kind public.activity_kind not null,
  created_at timestamptz not null default now(),
  foreign key (ranking_id, user_id, movie_id)
    references public.rankings(id, user_id, movie_id) on delete cascade
);
comment on table public.activity is 'Trigger-authored structured events. Render with activity_feed; do not store stale prose or allow clients to fabricate events.';

create index rankings_user_movie_latest on public.rankings
  (user_id, movie_id, watched_date desc nulls last, created_at desc, id desc);
create index rankings_movie_recent on public.rankings(movie_id, created_at desc, id desc);
create index follows_inbound_status on public.follows(following_id, status, follower_id);
create index follows_outbound_status on public.follows(follower_id, status, following_id);
create index blocks_inbound on public.blocks(blocked_id, blocker_id);
create index lists_owner on public.lists(user_id, created_at desc, id desc);
create index list_items_movie on public.list_items(movie_id);
create index activity_recent on public.activity(created_at desc, id desc);
create index activity_actor_recent on public.activity(user_id, created_at desc, id desc);
create index activity_movie on public.activity(movie_id);

alter table public.users enable row level security;
alter table public.movies enable row level security;
alter table public.rankings enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;
alter table public.activity enable row level security;

-- Supabase projects can have broad default grants. Start from an explicit deny.
revoke all on public.users, public.movies, public.rankings, public.follows,
  public.blocks, public.lists, public.list_items, public.activity from public, anon, authenticated;
grant select, insert, update, delete on public.users, public.movies, public.rankings,
  public.follows, public.blocks, public.lists, public.list_items, public.activity to service_role;

commit;
