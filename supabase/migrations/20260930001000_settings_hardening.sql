-- Settings hardening after review: enforce account-deletion safeguards in the
-- database, constrain direct avatar uploads, rate-limit password re-checks, and
-- keep failing cleanups from starving newer ones.
begin;

-- Account deletion: the recent sign-in and typed-username confirmation used to be
-- checked only by the app, so a stolen token could call the RPC directly. Both are
-- now required here. The sign-in time comes from the token's `amr` claim, which
-- Supabase Auth sets at sign-in and keeps unchanged on refresh.
drop function public.request_account_deletion();
create function public.request_account_deletion(confirmation text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  claims jsonb := auth.jwt();
  signed_in_at bigint;
  handle text;
begin
  if me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  -- Idempotent: a repeat after the profile is gone keeps the queue row as it is.
  if exists (select 1 from codebox_private.account_deletions d where d.user_id = me) then
    return;
  end if;
  select max((entry ->> 'timestamp')::bigint) into signed_in_at
  from jsonb_array_elements(
    case when jsonb_typeof(claims -> 'amr') = 'array' then claims -> 'amr' else '[]'::jsonb end
  ) entry
  where jsonb_typeof(entry) = 'object' and entry ->> 'timestamp' ~ '^[0-9]{1,12}$';
  if signed_in_at is null or extract(epoch from now()) - signed_in_at > 600 then
    raise exception 'Recent sign-in required' using errcode = '42501';
  end if;
  select u.username into handle from public.users u where u.id = me;
  if handle is null or lower(btrim(coalesce(confirmation, ''))) <> handle then
    raise exception 'Confirmation does not match' using errcode = '22023';
  end if;

  insert into codebox_private.account_deletions(user_id) values (me);
  update auth.users set banned_until = now() + interval '100 years' where id = me;
  delete from auth.sessions where user_id = me;
  update public.reports set details = null
  where reporter_id = me or target_user_id = me;
  delete from public.users where id = me;
end;
$$;
revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;

-- Retry the least-attempted work first, so a few permanently failing rows can't
-- block newer deletions forever.
create or replace function public.pending_account_deletions(max_rows integer default 20)
returns table (user_id uuid, attempts integer)
language sql stable security definer set search_path = '' as $$
  select d.user_id, d.attempts from codebox_private.account_deletions d
  where d.completed_at is null
  order by d.attempts, d.requested_at
  limit greatest(1, least(max_rows, 100));
$$;
revoke all on function public.pending_account_deletions(integer) from public, anon, authenticated;
grant execute on function public.pending_account_deletions(integer) to service_role;

-- Avatars: owners still write their own folder with their own session, but only
-- in the shape the server produces (<uid>/<uuid>.webp), only when they may
-- contribute (verified email, username, account not deleted), and at most three
-- files at a time. The bucket now accepts only WebP, which is all the server
-- stores after re-encoding JPEG/PNG/WebP uploads.
update storage.buckets set allowed_mime_types = array['image/webp'] where id = 'avatars';

create function codebox_private.avatar_upload_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select count(*) < 3 from storage.objects o
  where o.bucket_id = 'avatars' and o.name like auth.uid()::text || '/%';
$$;
revoke all on function codebox_private.avatar_upload_allowed() from public, anon;
grant execute on function codebox_private.avatar_upload_allowed() to authenticated;

drop policy avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    and (select codebox_private.can_contribute())
    and (select codebox_private.avatar_upload_allowed())
  );

-- Password re-checks before account deletion: 5 per user per 15 minutes, on top
-- of Supabase Auth's own limits (which see the server's IP, not the user's).
alter table codebox_private.movie_request_limits
  drop constraint movie_request_limits_scope_check,
  add constraint movie_request_limits_scope_check
    check (scope in ('search', 'selection', 'avatar', 'reauth'));
create or replace function public.consume_movie_request_limit(request_scope text, key_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_time timestamptz := clock_timestamp(); duration interval;
  maximum integer; counter codebox_private.movie_request_limits%rowtype;
begin
  if request_scope is null or request_scope not in ('search', 'selection', 'avatar', 'reauth')
     or key_hash is null or key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid request bucket' using errcode = '22023';
  end if;
  duration := case request_scope when 'search' then interval '1 minute'
    when 'selection' then interval '10 minutes' when 'reauth' then interval '15 minutes'
    else interval '1 hour' end;
  maximum := case request_scope when 'search' then 60 when 'selection' then 30
    when 'reauth' then 5 else 10 end;
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
revoke all on function public.consume_movie_request_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_movie_request_limit(text, text) to service_role;

commit;
