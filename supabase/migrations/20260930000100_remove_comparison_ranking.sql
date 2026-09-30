-- Remove the comparison-ranking model (liked/fine/disliked buckets and placement
-- positions). The rankings table keeps score, stars, reviews and watch history.
-- Data loss: existing rankings.bucket and rankings.position values are discarded.
begin;

-- Never shipped; dropped defensively in case a database received them out of band.
drop function if exists public.insert_ranking;
drop function if exists public.delete_ranking;
drop function if exists public.recompute_bucket;

-- These views reference bucket (current_rankings via r.*); recreate them below.
drop view public.activity_feed;
drop view public.public_reviews;
drop view public.public_current_ratings;
drop view public.current_rankings;

alter table public.rankings drop constraint rankings_score_bucket;
alter table public.rankings drop column bucket, drop column position;
drop type public.ranking_bucket;

comment on column public.rankings.score is 'Independent decimal ranking score, 0.0–10.0; no star conversion.';

create view public.public_reviews with (security_barrier = true) as
  select r.id, r.user_id, r.movie_id, r.score, r.star_half_units,
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
    r.id, r.user_id, r.movie_id, r.score, r.star_half_units
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

-- Dropping the columns removed their column grants; recreated views need explicit grants.
revoke all on public.public_reviews, public.current_rankings,
  public.public_current_ratings, public.activity_feed from public, anon, authenticated;
grant select on public.public_reviews, public.current_rankings,
  public.public_current_ratings, public.activity_feed to anon, authenticated, service_role;

commit;
