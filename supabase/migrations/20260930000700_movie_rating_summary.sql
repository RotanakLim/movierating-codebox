-- Community average for a movie page: one current score per author (same precedence
-- as current_entries), including restricted-profile authors' public scores.
-- Security definer on purpose: public_current_ratings filters out accounts the viewer
-- blocked or was blocked by, and SPEC says blocking must not change the aggregate.
begin;

create function public.movie_rating_summary(target_movie_id bigint)
returns table (average numeric, raters integer)
language sql stable security definer set search_path = '' as $$
  with current_scores as (
    select distinct on (e.user_id) e.score
    from public.entries e
    where e.movie_id = target_movie_id and e.score is not null
    order by e.user_id, e.watched_date desc nulls last, e.created_at desc, e.id desc
  )
  -- Always one row: average is NULL and raters 0 when nobody has scored the movie.
  select round(avg(c.score), 1), count(*)::integer from current_scores c;
$$;
comment on function public.movie_rating_summary(bigint) is
  'Viewer-independent community average (0.0–10.0, one decimal) and rater count. Exposes only aggregates.';
revoke all on function public.movie_rating_summary(bigint) from public;
grant execute on function public.movie_rating_summary(bigint) to anon, authenticated, service_role;

-- Serves the per-movie DISTINCT ON above without scanning every entry for the movie.
create index entries_movie_current_scores on public.entries
  (movie_id, user_id, watched_date desc nulls last, created_at desc, id desc)
  where score is not null;

commit;
