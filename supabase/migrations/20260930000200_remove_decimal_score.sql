-- Stars are the only rating: 1–5 in half-star steps, stored as star_half_units 2–10.
-- Remove the decimal 0.0–10.0 rankings.score. Existing scores become stars where an
-- entry has none (round(score), clamped to 2–10), so no rated entry loses its rating.
begin;

update public.rankings
set star_half_units = least(10, greatest(2, round(score)::smallint))
where score is not null and star_half_units is null;

drop view public.activity_feed;
drop view public.public_reviews;
drop view public.public_current_ratings;
drop view public.current_rankings;

-- rankings_content referenced score and is dropped with it; recreate it below.
alter table public.rankings drop constraint rankings_content;
alter table public.rankings drop column score;
alter table public.rankings add constraint rankings_content check (
  watched or star_half_units is not null
  or coalesce(char_length(btrim(note)) > 0, false)
);
comment on column public.rankings.star_half_units is 'The only rating: 1–5 stars in half-star steps (2–10 half-units). NULL means unrated.';

create or replace function codebox_private.can_view_activity(entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rankings r where r.id = entry_id
    and codebox_private.not_blocked(r.user_id)
    and (r.star_half_units is not null or r.note is not null
      or codebox_private.can_view_profile(r.user_id))
  );
$$;

create or replace function codebox_private.sync_ranking_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_kind public.activity_kind;
begin
  event_kind := case
    when new.star_half_units is not null then 'ranked'::public.activity_kind
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
  select r.id, r.user_id, r.movie_id, r.star_half_units,
    r.note, r.spoiler, r.created_at, r.updated_at
  from public.rankings r
  where (r.star_half_units is not null or r.note is not null)
    and codebox_private.not_blocked(r.user_id);

create view public.current_rankings with (security_invoker = true) as
  select distinct on (r.user_id, r.movie_id) r.* from public.rankings r
  where r.star_half_units is not null
  order by r.user_id, r.movie_id, r.watched_date desc nulls last, r.created_at desc, r.id desc;

create view public.public_current_ratings with (security_barrier = true) as
  select distinct on (r.user_id, r.movie_id)
    r.id, r.user_id, r.movie_id, r.star_half_units
  from public.rankings r
  where r.star_half_units is not null
    and codebox_private.not_blocked(r.user_id)
  order by r.user_id, r.movie_id, r.watched_date desc nulls last, r.created_at desc, r.id desc;

create view public.activity_feed with (security_invoker = true) as
  select a.id, a.user_id, a.movie_id, a.ranking_id, a.kind, a.created_at,
    u.username, u.avatar, m.title, m.poster, m.year, r.star_half_units,
    case
      when a.kind = 'ranked' then u.username || ' rated ' || m.title || ' ' || (r.star_half_units / 2.0)::numeric(2,1)::text || ' stars'
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
