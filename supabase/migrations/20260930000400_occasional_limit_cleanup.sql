-- Expired request-limit rows were deleted on every call, adding a table scan to every
-- search. Clean up on roughly 1% of calls instead; stale rows are harmless until then
-- because an expired window is reset on its next use.
begin;
create or replace function public.consume_movie_request_limit(request_scope text, key_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_time timestamptz := clock_timestamp(); duration interval;
  maximum integer; counter codebox_private.movie_request_limits%rowtype;
begin
  if request_scope is null or request_scope not in ('search', 'selection')
     or key_hash is null or key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid request bucket' using errcode = '22023';
  end if;
  duration := case when request_scope = 'search' then interval '1 minute' else interval '10 minutes' end;
  maximum := case when request_scope = 'search' then 60 else 30 end;
  insert into codebox_private.movie_request_limits as limits(scope, key_hash, window_started_at, hits)
  values (request_scope, key_hash, request_time, 1)
  on conflict on constraint movie_request_limits_pkey do update set
    window_started_at = case when limits.window_started_at + duration <= request_time then request_time else limits.window_started_at end,
    hits = case when limits.window_started_at + duration <= request_time then 1 else least(limits.hits + 1, maximum + 1) end
  returning * into counter;
  if pg_catalog.random() < 0.01 then
    delete from codebox_private.movie_request_limits where window_started_at < request_time - interval '1 day';
  end if;
  return jsonb_build_object('allowed', counter.hits <= maximum, 'retry_after',
    greatest(1, ceil(extract(epoch from counter.window_started_at + duration - request_time))::integer));
end;
$$;
-- CREATE OR REPLACE keeps the existing grants; restate them so this file stands alone.
revoke all on function public.consume_movie_request_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_movie_request_limit(text, text) to service_role;
commit;
