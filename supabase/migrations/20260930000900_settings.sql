-- Settings: avatar storage, account theme, and account deletion (SPEC sections 4 and 9).
begin;

-- Avatars: public reads by URL; only the owner writes under <auth uid>/.
-- The server re-encodes every upload to WebP before storing it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket files are served by URL without a SELECT policy, so nobody can
-- list other people's folders. Owners may see, add and remove their own files.
create policy avatars_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Avatar uploads share the persistent request limits: 10 per user per hour.
alter table codebox_private.movie_request_limits
  drop constraint movie_request_limits_scope_check,
  add constraint movie_request_limits_scope_check check (scope in ('search', 'selection', 'avatar'));
create or replace function public.consume_movie_request_limit(request_scope text, key_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_time timestamptz := clock_timestamp(); duration interval;
  maximum integer; counter codebox_private.movie_request_limits%rowtype;
begin
  if request_scope is null or request_scope not in ('search', 'selection', 'avatar')
     or key_hash is null or key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid request bucket' using errcode = '22023';
  end if;
  duration := case request_scope when 'search' then interval '1 minute'
    when 'selection' then interval '10 minutes' else interval '1 hour' end;
  maximum := case request_scope when 'search' then 60 when 'selection' then 30 else 10 end;
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

-- Account theme (owner-only, with the other private preferences). The browser keeps
-- its localStorage copy for the no-flash script; this syncs it across devices.
-- NULL = never chosen, so a choice made before signing in is kept, not reset.
alter table public.user_preferences add column theme text
  check (theme in ('system', 'light', 'dark'));
grant insert (theme), update (theme) on public.user_preferences to authenticated;

-- Reports outlive the people in them, without identifying a deleted account.
alter table public.reports drop constraint reports_reporter_id_fkey;
alter table public.reports drop constraint reports_target_user_id_fkey;
alter table public.reports alter column reporter_id drop not null;
alter table public.reports alter column target_user_id drop not null;
alter table public.reports add constraint reports_reporter_id_fkey
  foreign key (reporter_id) references public.users(id) on delete set null;
alter table public.reports add constraint reports_target_user_id_fkey
  foreign key (target_user_id) references public.users(id) on delete set null;

-- Deletion queue: private, processed by the server with the service role.
create table codebox_private.account_deletions (
  user_id uuid primary key,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  completed_at timestamptz
);
alter table codebox_private.account_deletions enable row level security;
revoke all on codebox_private.account_deletions from public, anon, authenticated, service_role;

-- Step 1, run by the signed-in user: disable access and hide everything immediately,
-- then queue the rest. Banning the auth user and deleting its sessions stops sign-in
-- and token refresh at once (the server's cleanup then deletes the auth identity).
-- Deleting the profile row cascades entries (and their feed events), follows,
-- blocks, lists, watchlist, favorites and preferences. Report details that could
-- identify the person are redacted; the reports themselves remain, anonymised.
-- Idempotent: calling again after the profile is gone only keeps the queue row.
create function public.request_account_deletion()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  insert into codebox_private.account_deletions(user_id) values (me)
  on conflict (user_id) do nothing;
  update auth.users set banned_until = now() + interval '100 years' where id = me;
  delete from auth.sessions where user_id = me;
  update public.reports set details = null
  where reporter_id = me or target_user_id = me;
  delete from public.users where id = me;
end;
$$;
revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

-- Step 2 helpers for the server (service role only): list unfinished work and
-- record each attempt. Completed rows are kept as a minimal, non-identifying log.
create function public.pending_account_deletions(max_rows integer default 20)
returns table (user_id uuid, attempts integer)
language sql stable security definer set search_path = '' as $$
  select d.user_id, d.attempts from codebox_private.account_deletions d
  where d.completed_at is null
  order by d.requested_at
  limit greatest(1, least(max_rows, 100));
$$;
create function public.record_account_deletion_attempt(target uuid, failure text default null)
returns void language sql volatile security definer set search_path = '' as $$
  update codebox_private.account_deletions set
    attempts = attempts + 1,
    last_error = left(failure, 500),
    completed_at = case when failure is null then now() else null end
  where user_id = target and completed_at is null;
$$;
revoke all on function public.pending_account_deletions(integer),
  public.record_account_deletion_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.pending_account_deletions(integer),
  public.record_account_deletion_attempt(uuid, text) to service_role;

commit;
