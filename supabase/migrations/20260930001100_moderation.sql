-- Core-preview safety (SPEC sections 8 and 9): review reports, an admin-only
-- moderation queue with audited actions, hidden content, suspended accounts, and
-- persisted per-user limits on new entries and reports.
begin;

-- Admins live in a private table with no API grants. The only way to add one is
-- SQL run by the project owner (see DATABASE.md); there is no public role path.
create table codebox_private.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 200)
);
alter table codebox_private.admin_roles enable row level security;
revoke all on codebox_private.admin_roles from public, anon, authenticated, service_role;

create function codebox_private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from codebox_private.admin_roles r
    join auth.users a on a.id = r.user_id
    where r.user_id = auth.uid() and (a.banned_until is null or a.banned_until <= now())
  );
$$;

-- Moderation state is kept apart from user-editable rows, so no column grant can
-- ever let an author unhide their own content or lift a suspension.
create table codebox_private.hidden_entries (
  entry_id uuid primary key references public.entries(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  action_id uuid
);
create table codebox_private.suspended_users (
  user_id uuid primary key references public.users(id) on delete cascade,
  suspended_at timestamptz not null default now(),
  action_id uuid
);
alter table codebox_private.hidden_entries enable row level security;
alter table codebox_private.suspended_users enable row level security;
revoke all on codebox_private.hidden_entries, codebox_private.suspended_users
  from public, anon, authenticated, service_role;

create function codebox_private.is_suspended(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from codebox_private.suspended_users s where s.user_id = target);
$$;
create function codebox_private.entry_is_public(target_entry uuid, author uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from codebox_private.hidden_entries h where h.entry_id = target_entry)
    and not exists (select 1 from codebox_private.suspended_users s where s.user_id = author);
$$;

-- Suspended accounts cannot contribute: every entry, list, follow, block and report
-- policy already requires can_contribute().
create or replace function codebox_private.can_contribute()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users a join public.users p on p.id = a.id
    where a.id = auth.uid() and a.email_confirmed_at is not null and p.username is not null
      and not exists (select 1 from codebox_private.suspended_users s where s.user_id = a.id)
  );
$$;

-- Suspended accounts cannot edit their profile text or avatar either.
drop policy users_update_self on public.users;
create policy users_update_self on public.users for update to authenticated
  using (id = (select auth.uid()) and not (select codebox_private.is_suspended(auth.uid())))
  with check (id = (select auth.uid()));

-- Hidden entries and suspended authors leave everyone else's view of collections,
-- diaries and profiles. Authors still see their own entries.
drop policy entries_read_profile on public.entries;
create policy entries_read_profile on public.entries for select to anon, authenticated
  using (codebox_private.can_view_profile(user_id)
    and (user_id = (select auth.uid()) or codebox_private.entry_is_public(id, user_id)));

create or replace function codebox_private.can_view_activity(entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entries e where e.id = entry_id
    and codebox_private.not_blocked(e.user_id)
    and (e.user_id = auth.uid() or codebox_private.entry_is_public(e.id, e.user_id))
    and (e.score is not null or e.note is not null
      or codebox_private.can_view_profile(e.user_id))
  );
$$;

-- Public projections and the community average skip hidden entries and suspended
-- authors. Filtering happens before choosing each author's current score.
create or replace view public.public_reviews with (security_barrier = true) as
  select e.id, e.user_id, e.movie_id, e.score,
    e.note, e.spoiler, e.created_at, e.updated_at
  from public.entries e
  where (e.score is not null or e.note is not null)
    and codebox_private.not_blocked(e.user_id)
    and not exists (select 1 from codebox_private.hidden_entries h where h.entry_id = e.id)
    and not exists (select 1 from codebox_private.suspended_users s where s.user_id = e.user_id);

create or replace view public.public_current_ratings with (security_barrier = true) as
  select distinct on (e.user_id, e.movie_id)
    e.id, e.user_id, e.movie_id, e.score
  from public.entries e
  where e.score is not null
    and codebox_private.not_blocked(e.user_id)
    and not exists (select 1 from codebox_private.hidden_entries h where h.entry_id = e.id)
    and not exists (select 1 from codebox_private.suspended_users s where s.user_id = e.user_id)
  order by e.user_id, e.movie_id, e.watched_date desc nulls last, e.created_at desc, e.id desc;

create or replace function public.movie_rating_summary(target_movie_id bigint)
returns table (average numeric, raters integer)
language sql stable security definer set search_path = '' as $$
  with current_scores as (
    select distinct on (e.user_id) e.score
    from public.entries e
    where e.movie_id = target_movie_id and e.score is not null
      and not exists (select 1 from codebox_private.hidden_entries h where h.entry_id = e.id)
      and not exists (select 1 from codebox_private.suspended_users s where s.user_id = e.user_id)
    order by e.user_id, e.watched_date desc nulls last, e.created_at desc, e.id desc
  )
  select round(avg(c.score), 1), count(*)::integer from current_scores c;
$$;

-- Persisted per-user limits on new entries and reports. Settings are a private
-- table so the owner can tune them with SQL; counters are fixed windows that
-- survive deletes and restarts. A refused attempt rolls back and costs nothing.
create table codebox_private.action_limit_settings (
  action text primary key check (action in ('entry', 'report')),
  max_actions integer not null check (max_actions > 0),
  window_seconds integer not null check (window_seconds between 60 and 604800)
);
insert into codebox_private.action_limit_settings values
  ('entry', 20, 3600),
  ('report', 10, 86400);
create table codebox_private.action_limits (
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null references codebox_private.action_limit_settings(action) on delete cascade,
  window_started_at timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (user_id, action)
);
alter table codebox_private.action_limit_settings enable row level security;
alter table codebox_private.action_limits enable row level security;
revoke all on codebox_private.action_limit_settings, codebox_private.action_limits
  from public, anon, authenticated, service_role;

-- Raises SQLSTATE PT429 (PostgREST answers HTTP 429) with the seconds until the
-- window resets in DETAIL and the action in HINT.
create function codebox_private.consume_action_limit(limit_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  request_time timestamptz := clock_timestamp();
  settings codebox_private.action_limit_settings%rowtype;
  duration interval;
  counter codebox_private.action_limits%rowtype;
begin
  -- Accounts that can't contribute are refused by RLS after this trigger; don't count them.
  if me is null or not codebox_private.can_contribute() then return; end if;
  select * into settings from codebox_private.action_limit_settings s where s.action = limit_action;
  if not found then return; end if;
  duration := make_interval(secs => settings.window_seconds);
  insert into codebox_private.action_limits as l(user_id, action, window_started_at, hits)
  values (me, limit_action, request_time, 1)
  on conflict (user_id, action) do update set
    window_started_at = case when l.window_started_at + duration <= request_time then request_time else l.window_started_at end,
    hits = case when l.window_started_at + duration <= request_time then 1 else l.hits + 1 end
  returning * into counter;
  if counter.hits > settings.max_actions then
    raise exception 'Rate limit reached' using errcode = 'PT429',
      detail = greatest(1, ceil(extract(epoch from counter.window_started_at + duration - request_time)))::integer::text,
      hint = limit_action;
  end if;
end;
$$;

create function codebox_private.limit_new_entries()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform codebox_private.consume_action_limit('entry');
  return new;
end;
$$;
create trigger entries_rate_limit before insert on public.entries
for each row execute function codebox_private.limit_new_entries();

-- Reports now cover reviews as well as users. A review report records the review's
-- author (from the database, never the client) and a snapshot of what was reported,
-- so moderators see it even if it is edited or deleted afterwards.
alter table public.reports
  add column target_kind text not null default 'user' check (target_kind in ('user', 'review')),
  add column target_entry_id uuid references public.entries(id) on delete set null,
  add column entry_snapshot jsonb,
  add column resolved_at timestamptz;
drop index public.reports_one_open_per_target;
create unique index reports_one_open_per_user on public.reports(reporter_id, target_user_id)
  where status = 'open' and target_kind = 'user';
create unique index reports_one_open_per_review on public.reports(reporter_id, target_entry_id)
  where status = 'open' and target_kind = 'review';
create index reports_queue on public.reports(status, created_at desc);

create function codebox_private.prepare_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare reviewed public.entries%rowtype;
begin
  perform codebox_private.consume_action_limit('report');
  new.status := 'open';
  new.resolved_at := null;
  if new.target_entry_id is not null then
    select * into reviewed from public.entries e where e.id = new.target_entry_id;
    if not found or (reviewed.score is null and reviewed.note is null)
       or not codebox_private.entry_is_public(reviewed.id, reviewed.user_id) then
      raise exception 'Only public reviews can be reported' using errcode = '23514';
    end if;
    new.target_kind := 'review';
    new.target_user_id := reviewed.user_id;
    new.entry_snapshot := jsonb_build_object(
      'movie_id', reviewed.movie_id, 'score', reviewed.score, 'note', reviewed.note,
      'spoiler', reviewed.spoiler, 'updated_at', reviewed.updated_at);
  else
    if new.target_user_id is null then
      raise exception 'Choose who to report' using errcode = '23514';
    end if;
    new.target_kind := 'user';
    new.entry_snapshot := null;
  end if;
  return new;
end;
$$;
create trigger reports_prepare before insert on public.reports
for each row execute function codebox_private.prepare_report();
grant insert (id, reporter_id, target_user_id, target_entry_id, reason, details)
  on public.reports to authenticated;

-- Audit log: every admin action with its required reason. Deleting an account
-- nulls its IDs here, leaving a minimal, non-identifying record.
create table codebox_private.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('dismiss', 'hide', 'suspend', 'restore')),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  report_id uuid references public.reports(id) on delete set null,
  target_user_id uuid references public.users(id) on delete set null,
  target_entry_id uuid references public.entries(id) on delete set null,
  created_at timestamptz not null default now()
);
create index moderation_actions_recent on codebox_private.moderation_actions(created_at desc);
alter table codebox_private.moderation_actions enable row level security;
revoke all on codebox_private.moderation_actions from public, anon, authenticated, service_role;

-- The one write path for moderators. Admin-only; every call needs a reason and is
-- audited in the same transaction.
--   dismiss: close an open report without action.
--   hide:    hide a review (the report's, or target_entry) and resolve the report.
--   suspend: suspend an account (the report's target, or target_user) and resolve.
--   restore: unhide target_entry, or lift target_user's suspension.
create function public.admin_moderate(
  action text, reason text, report uuid default null,
  target_entry uuid default null, target_user uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  note text := btrim(coalesce(reason, ''));
  item public.reports%rowtype;
  action_id uuid := gen_random_uuid();
begin
  if not codebox_private.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if char_length(note) not between 1 and 1000 then
    raise exception 'A reason (up to 1,000 characters) is required' using errcode = '22023';
  end if;
  if report is not null then
    select * into item from public.reports r where r.id = report for update;
    if not found then raise exception 'Report not found' using errcode = '22023'; end if;
    if action in ('dismiss', 'hide', 'suspend') and item.status <> 'open' then
      raise exception 'This report is already closed' using errcode = '22023';
    end if;
    if action = 'hide' then target_entry := coalesce(target_entry, item.target_entry_id); end if;
    if action = 'suspend' then target_user := coalesce(target_user, item.target_user_id); end if;
  end if;

  if action = 'dismiss' then
    if report is null then raise exception 'Choose a report to dismiss' using errcode = '22023'; end if;
    target_entry := item.target_entry_id;
    target_user := item.target_user_id;
    update public.reports set status = 'dismissed', resolved_at = now() where id = report;
  elsif action = 'hide' then
    if target_entry is null or not exists (select 1 from public.entries e where e.id = target_entry) then
      raise exception 'That content no longer exists' using errcode = '22023';
    end if;
    select e.user_id into target_user from public.entries e where e.id = target_entry;
    insert into codebox_private.hidden_entries(entry_id, action_id) values (target_entry, action_id)
    on conflict (entry_id) do nothing;
  elsif action = 'suspend' then
    if target_user is null or not exists (select 1 from public.users u where u.id = target_user) then
      raise exception 'That account no longer exists' using errcode = '22023';
    end if;
    if target_user = me then
      raise exception 'Admins cannot suspend themselves' using errcode = '22023';
    end if;
    insert into codebox_private.suspended_users(user_id, action_id) values (target_user, action_id)
    on conflict (user_id) do nothing;
  elsif action = 'restore' then
    if (target_entry is null) = (target_user is null) then
      raise exception 'Restore one review or one account at a time' using errcode = '22023';
    end if;
    if target_entry is not null then
      delete from codebox_private.hidden_entries h where h.entry_id = target_entry;
      if not found then raise exception 'That content is not hidden' using errcode = '22023'; end if;
      select e.user_id into target_user from public.entries e where e.id = target_entry;
    else
      delete from codebox_private.suspended_users s where s.user_id = target_user;
      if not found then raise exception 'That account is not suspended' using errcode = '22023'; end if;
    end if;
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;

  if report is not null and action in ('hide', 'suspend') then
    update public.reports set status = 'resolved', resolved_at = now() where id = report;
  end if;
  insert into codebox_private.moderation_actions(id, admin_id, action, reason, report_id, target_user_id, target_entry_id)
  values (action_id, me, action, note, report, target_user, target_entry);
  return action_id;
end;
$$;

create function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select codebox_private.is_admin();
$$;

-- The admin queue: report context without exposing anything to non-admins.
create function public.admin_reports(filter_status public.report_status default 'open', max_rows integer default 50)
returns table (
  id uuid, status public.report_status, reason public.report_reason, details text,
  created_at timestamptz, resolved_at timestamptz, target_kind text,
  reporter_username text, target_user_id uuid, target_username text, target_suspended boolean,
  target_entry_id uuid, entry_hidden boolean, entry_deleted boolean,
  movie_id bigint, movie_title text, entry_score numeric, entry_note text, entry_spoiler boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not codebox_private.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
  select r.id, r.status, r.reason, r.details, r.created_at, r.resolved_at, r.target_kind,
    reporter.username, r.target_user_id, target.username,
    exists (select 1 from codebox_private.suspended_users s where s.user_id = r.target_user_id),
    r.target_entry_id,
    exists (select 1 from codebox_private.hidden_entries h where h.entry_id = r.target_entry_id),
    r.target_kind = 'review' and e.id is null,
    coalesce(e.movie_id, (r.entry_snapshot ->> 'movie_id')::bigint), m.title,
    coalesce(e.score, (r.entry_snapshot ->> 'score')::numeric),
    coalesce(e.note, r.entry_snapshot ->> 'note'),
    coalesce(e.spoiler, (r.entry_snapshot ->> 'spoiler')::boolean)
  from public.reports r
  left join public.users reporter on reporter.id = r.reporter_id
  left join public.users target on target.id = r.target_user_id
  left join public.entries e on e.id = r.target_entry_id
  left join public.movies m on m.tmdb_id = coalesce(e.movie_id, (r.entry_snapshot ->> 'movie_id')::bigint)
  where r.status = filter_status
  order by r.created_at desc, r.id desc
  limit greatest(1, least(coalesce(max_rows, 50), 200));
end;
$$;

create function public.admin_moderation_log(max_rows integer default 50)
returns table (
  id uuid, action text, reason text, created_at timestamptz, admin_username text,
  report_id uuid, target_user_id uuid, target_username text, target_entry_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not codebox_private.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
  select a.id, a.action, a.reason, a.created_at, admin.username, a.report_id,
    a.target_user_id, target.username, a.target_entry_id
  from codebox_private.moderation_actions a
  left join public.users admin on admin.id = a.admin_id
  left join public.users target on target.id = a.target_user_id
  order by a.created_at desc, a.id desc
  limit greatest(1, least(coalesce(max_rows, 50), 200));
end;
$$;

-- Whether the signed-in user is suspended, so the app can explain refused writes.
create function public.my_account_suspended()
returns boolean language sql stable security definer set search_path = '' as $$
  select codebox_private.is_suspended(auth.uid());
$$;

-- Account deletion also redacts review snapshots in reports about the account.
create or replace function public.request_account_deletion(confirmation text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  claims jsonb := auth.jwt();
  signed_in_at bigint;
  handle text;
begin
  if me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
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
  update public.reports set details = null, entry_snapshot = null
  where reporter_id = me or target_user_id = me;
  delete from public.users where id = me;
end;
$$;

revoke all on function
  codebox_private.is_admin(), codebox_private.is_suspended(uuid),
  codebox_private.entry_is_public(uuid, uuid), codebox_private.consume_action_limit(text),
  codebox_private.limit_new_entries(), codebox_private.prepare_report(),
  public.admin_moderate(text, text, uuid, uuid, uuid), public.is_admin(),
  public.admin_reports(public.report_status, integer), public.admin_moderation_log(integer),
  public.my_account_suspended()
  from public, anon, authenticated;
-- Used inside RLS policies and invoker views, so every client role needs them.
grant execute on function codebox_private.is_suspended(uuid),
  codebox_private.entry_is_public(uuid, uuid) to anon, authenticated, service_role;
grant execute on function codebox_private.is_admin(), public.is_admin(),
  public.admin_moderate(text, text, uuid, uuid, uuid),
  public.admin_reports(public.report_status, integer), public.admin_moderation_log(integer),
  public.my_account_suspended() to authenticated;
revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;

commit;
