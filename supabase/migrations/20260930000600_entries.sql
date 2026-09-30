-- Rename rankings to entries (SPEC's name for diary/review entries), and make the
-- database reject scores with more than one decimal place instead of rounding them.
begin;

-- Views are rebuilt below: they expose renamed columns and depend on score's type.
drop view public.activity_feed;
drop view public.public_reviews;
drop view public.public_current_ratings;
drop view public.current_rankings;

alter table public.rankings rename to entries;
alter table public.activity rename column ranking_id to entry_id;
alter type public.activity_kind rename value 'ranked' to 'rated';

-- Rename constraints, indexes, policies and triggers that carry the old name.
do $$
declare item record;
begin
  for item in
    select conrelid::regclass as tbl, conname from pg_catalog.pg_constraint
    where conrelid in ('public.entries'::regclass, 'public.activity'::regclass)
      and (conname like 'rankings\_%' or conname like '%ranking\_id%')
  loop
    execute format('alter table %s rename constraint %I to %I', item.tbl, item.conname,
      replace(replace(item.conname, 'rankings_', 'entries_'), 'ranking_id', 'entry_id'));
  end loop;
  for item in
    select indexname from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname like 'rankings\_%'
  loop
    execute format('alter index public.%I rename to %I', item.indexname,
      replace(item.indexname, 'rankings_', 'entries_'));
  end loop;
  for item in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'entries' and policyname like 'rankings\_%'
  loop
    execute format('alter policy %I on public.entries rename to %I', item.policyname,
      replace(item.policyname, 'rankings_', 'entries_'));
  end loop;
end;
$$;
alter trigger rankings_guard on public.entries rename to entries_guard;
alter trigger rankings_sync_activity on public.entries rename to entries_sync_activity;
alter function codebox_private.guard_ranking() rename to guard_entry;
alter function codebox_private.sync_ranking_activity() rename to sync_entry_activity;

-- numeric(3,1) silently rounds 9.55 to 9.6 before any check runs. Store plain numeric,
-- reject extra decimals in the guard trigger, and normalise accepted values to one
-- decimal place (8 -> 8.0) there.
alter table public.entries drop constraint entries_score_check;
alter table public.entries alter column score type numeric;
alter table public.entries add constraint entries_score_check check (score between 0 and 10);
comment on column public.entries.score is 'The only rating: 0.0–10.0 with exactly one decimal place. NULL means unrated. Extra decimals are rejected, never rounded.';
comment on table public.entries is 'One editable diary/review entry, not a unique user/movie row. Rewatches preserve history; current_entries selects the latest scored opinion.';

-- Function bodies are stored as text, so every body naming rankings/ranking_id/'ranked'
-- is recreated. CREATE OR REPLACE keeps each function's grants.
create or replace function codebox_private.guard_entry()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.score is not null then
    if new.score <> round(new.score, 1) then
      raise exception 'Scores use one decimal place' using errcode = '23514';
    end if;
    new.score := new.score::numeric(3,1);
  end if;
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
      raise exception 'Entry identity, owner, movie and creation time are immutable' using errcode = '23514';
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

create or replace function codebox_private.sync_entry_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_kind public.activity_kind;
begin
  event_kind := case
    when new.score is not null then 'rated'::public.activity_kind
    when new.note is not null then 'reviewed'::public.activity_kind
    else 'watched'::public.activity_kind end;
  insert into public.activity(user_id, movie_id, entry_id, kind, created_at)
  values (new.user_id, new.movie_id, new.id, event_kind, new.created_at)
  on conflict (entry_id) do update set kind = excluded.kind;
  -- Edits never bump activity.created_at; deletes cascade via entry_id.
  -- Same transaction as the entry write: a watched save and its watchlist removal
  -- commit or roll back together.
  if new.watched then
    delete from public.list_items i using public.lists l
    where i.list_id = l.id and l.user_id = new.user_id
      and l.kind = 'watchlist' and i.movie_id = new.movie_id;
  end if;
  return new;
end;
$$;

create or replace function codebox_private.can_view_activity(entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entries e where e.id = entry_id
    and codebox_private.not_blocked(e.user_id)
    and (e.score is not null or e.note is not null
      or codebox_private.can_view_profile(e.user_id))
  );
$$;

create view public.public_reviews with (security_barrier = true) as
  select e.id, e.user_id, e.movie_id, e.score,
    e.note, e.spoiler, e.created_at, e.updated_at
  from public.entries e
  where (e.score is not null or e.note is not null)
    and codebox_private.not_blocked(e.user_id);

create view public.current_entries with (security_invoker = true) as
  select distinct on (e.user_id, e.movie_id) e.* from public.entries e
  where e.score is not null
  order by e.user_id, e.movie_id, e.watched_date desc nulls last, e.created_at desc, e.id desc;

create view public.public_current_ratings with (security_barrier = true) as
  select distinct on (e.user_id, e.movie_id)
    e.id, e.user_id, e.movie_id, e.score
  from public.entries e
  where e.score is not null
    and codebox_private.not_blocked(e.user_id)
  order by e.user_id, e.movie_id, e.watched_date desc nulls last, e.created_at desc, e.id desc;

create view public.activity_feed with (security_invoker = true) as
  select a.id, a.user_id, a.movie_id, a.entry_id, a.kind, a.created_at,
    u.username, u.avatar, m.title, m.poster, m.year, r.score,
    case
      when a.kind = 'rated' then u.username || ' rated ' || m.title || ' ' || r.score::numeric(3,1)::text || '/10'
      when a.kind = 'reviewed' then u.username || ' reviewed ' || m.title
      else u.username || ' watched ' || m.title
    end as summary
  from public.activity a join public.user_identities u on u.id = a.user_id
  join public.movies m on m.tmdb_id = a.movie_id
  left join public.public_reviews r on r.id = a.entry_id;

revoke all on public.public_reviews, public.current_entries,
  public.public_current_ratings, public.activity_feed from public, anon, authenticated;
grant select on public.public_reviews, public.current_entries,
  public.public_current_ratings, public.activity_feed to anon, authenticated, service_role;

commit;
