-- The decimal score is the only rating: 0.0–10.0 with one decimal place (e.g. 1.0, 5.0,
-- 9.5), stored as rankings.score (NULL = unrated). Remove the half-star rating.
-- Existing star ratings are converted exactly: star_half_units 2–10 becomes score
-- 2.0–10.0 (4.5 stars = 9.0), so no rated entry loses its rating.
begin;

alter table public.rankings add column score numeric(3,1) check (score between 0 and 10);
comment on column public.rankings.score is 'The only rating: 0.0–10.0 with one decimal place. NULL means unrated.';

update public.rankings set score = star_half_units where star_half_units is not null;

drop view public.activity_feed;
drop view public.public_reviews;
drop view public.public_current_ratings;
drop view public.current_rankings;

-- rankings_content referenced star_half_units and is dropped with it; recreate it below.
alter table public.rankings drop constraint rankings_content;
alter table public.rankings drop column star_half_units;
alter table public.rankings add constraint rankings_content check (
  watched or score is not null
  or coalesce(char_length(btrim(note)) > 0, false)
);

-- Column-level grants from 20260929000200 do not cover the new column.
grant insert (score), update (score) on public.rankings to authenticated;

create or replace function codebox_private.can_view_activity(entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rankings r where r.id = entry_id
    and codebox_private.not_blocked(r.user_id)
    and (r.score is not null or r.note is not null
      or codebox_private.can_view_profile(r.user_id))
  );
$$;

create or replace function codebox_private.sync_ranking_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_kind public.activity_kind;
begin
  event_kind := case
    when new.score is not null then 'ranked'::public.activity_kind
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

create view public.public_reviews with (security_barrier = true) as
  select r.id, r.user_id, r.movie_id, r.score,
    r.note, r.spoiler, r.created_at, r.updated_at
  from public.rankings r
  where (r.score is not null or r.note is not null)
    and codebox_private.not_blocked(r.user_id);

create view public.current_rankings with (security_invoker = true) as
  select distinct on (r.user_id, r.movie_id) r.* from public.rankings r
  where r.score is not null
  order by r.user_id, r.movie_id, r.watched_date desc nulls last, r.created_at desc, r.id desc;

create view public.public_current_ratings with (security_barrier = true) as
  select distinct on (r.user_id, r.movie_id)
    r.id, r.user_id, r.movie_id, r.score
  from public.rankings r
  where r.score is not null
    and codebox_private.not_blocked(r.user_id)
  order by r.user_id, r.movie_id, r.watched_date desc nulls last, r.created_at desc, r.id desc;

create view public.activity_feed with (security_invoker = true) as
  select a.id, a.user_id, a.movie_id, a.ranking_id, a.kind, a.created_at,
    u.username, u.avatar, m.title, m.poster, m.year, r.score,
    case
      when a.kind = 'ranked' then u.username || ' rated ' || m.title || ' ' || r.score::text || '/10'
      when a.kind = 'reviewed' then u.username || ' reviewed ' || m.title
      else u.username || ' watched ' || m.title
    end as summary
  from public.activity a join public.user_identities u on u.id = a.user_id
  join public.movies m on m.tmdb_id = a.movie_id
  left join public.public_reviews r on r.id = a.ranking_id;

revoke all on public.public_reviews, public.current_rankings,
  public.public_current_ratings, public.activity_feed from public, anon, authenticated;
grant select on public.public_reviews, public.current_rankings,
  public.public_current_ratings, public.activity_feed to anon, authenticated, service_role;

commit;
