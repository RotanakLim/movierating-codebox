-- Public review pages (SPEC section 7): likes and one-level comment threads, with
-- per-user limits, block enforcement, comment reports and moderator hide/restore.
-- Clients have no direct table access: every read and write goes through the
-- functions below, which apply the visibility, block and ancestry rules.
begin;

-- Likes: one per user per review, reversible, never on your own review.
create table public.review_likes (
  entry_id uuid not null references public.entries(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);
create index review_likes_user on public.review_likes(user_id);

-- Comments: top-level (parent_id null) or a reply attached to a top-level comment.
-- A reply to a reply is stored on the same thread with reply_to_user_id set, so
-- there is never more than one level. A deleted comment that still has replies
-- keeps its row as a tombstone (no body, no author) so the thread survives.
create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  parent_id uuid references public.review_comments(id) on delete cascade,
  reply_to_user_id uuid references public.users(id) on delete set null,
  body text check (body is null or char_length(body) between 1 and 2000),
  spoiler boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check ((deleted_at is null) = (body is not null)),
  check (parent_id is distinct from id)
);
create index review_comments_threads on public.review_comments(entry_id, created_at, id)
  where parent_id is null;
create index review_comments_replies on public.review_comments(parent_id, created_at, id)
  where parent_id is not null;
create index review_comments_user on public.review_comments(user_id);
comment on table public.review_comments is 'Review discussion: one reply level, same-review ancestry, tombstones for deleted comments with replies. Read and written only through functions.';

-- Integrity for every writer, including the service role: a reply must belong to
-- the same review and hang off a top-level comment; nothing can be reparented.
create function codebox_private.guard_review_comment()
returns trigger language plpgsql set search_path = '' as $$
declare parent public.review_comments%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      select * into parent from public.review_comments c where c.id = new.parent_id;
      if not found or parent.entry_id <> new.entry_id then
        raise exception 'Replies must belong to the same review' using errcode = '23514';
      end if;
      if parent.parent_id is not null then
        raise exception 'Replies attach to the top-level comment' using errcode = '23514';
      end if;
    end if;
    new.created_at := now();
  else
    if new.entry_id is distinct from old.entry_id or new.parent_id is distinct from old.parent_id
       or new.created_at is distinct from old.created_at
       or (new.user_id is distinct from old.user_id and new.user_id is not null) then
      raise exception 'Comments cannot be moved or reassigned' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger review_comments_guard before insert or update on public.review_comments
for each row execute function codebox_private.guard_review_comment();

alter table public.review_likes enable row level security;
alter table public.review_comments enable row level security;
revoke all on public.review_likes, public.review_comments from public, anon, authenticated;
grant select, insert, update, delete on public.review_likes, public.review_comments to service_role;

-- Moderator-hidden comments, kept apart like hidden entries.
create table codebox_private.hidden_comments (
  comment_id uuid primary key references public.review_comments(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  action_id uuid
);
alter table codebox_private.hidden_comments enable row level security;
revoke all on codebox_private.hidden_comments from public, anon, authenticated, service_role;

-- New per-user limits: 100 like changes and 30 comments per 10 minutes.
alter table codebox_private.action_limit_settings
  drop constraint action_limit_settings_action_check,
  add constraint action_limit_settings_action_check
    check (action in ('entry', 'report', 'follow', 'like', 'comment'));
insert into codebox_private.action_limit_settings values ('like', 100, 600), ('comment', 30, 600);

-- A review page exists for public reviews (a score or text) that the viewer may
-- see: not hidden, author not suspended, and no block either way. Authors always
-- see their own.
create function codebox_private.review_visible(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entries e
    where e.id = target and (e.score is not null or e.note is not null)
      and (e.user_id = auth.uid()
        or (codebox_private.entry_is_public(e.id, e.user_id) and codebox_private.not_blocked(e.user_id)))
  );
$$;

-- How a comment appears to the viewer: visible, deleted (tombstone), removed
-- (hidden by a moderator or author suspended), or blocked (either way).
create function codebox_private.comment_state(target public.review_comments)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when target.deleted_at is not null then 'deleted'
    when exists (select 1 from codebox_private.hidden_comments h where h.comment_id = target.id) then 'removed'
    when target.user_id is not null and codebox_private.is_suspended(target.user_id) then 'removed'
    when target.user_id is not null and not codebox_private.not_blocked(target.user_id) then 'blocked'
    else 'visible'
  end;
$$;

-- The review itself, with counts from the database.
create function public.review_details(target uuid)
returns table (
  id uuid, user_id uuid, username text, avatar text, movie_id bigint, title text,
  poster text, year integer, score numeric, note text, spoiler boolean,
  created_at timestamptz, updated_at timestamptz,
  like_count integer, liked boolean, comment_count integer, is_hidden boolean
)
language sql stable security definer set search_path = '' as $$
  select e.id, e.user_id, u.username, u.avatar, e.movie_id, m.title, m.poster, m.year,
    e.score, e.note, e.spoiler, e.created_at, e.updated_at,
    (select count(*)::integer from public.review_likes l
      where l.entry_id = e.id and not codebox_private.is_suspended(l.user_id)),
    exists (select 1 from public.review_likes l where l.entry_id = e.id and l.user_id = auth.uid()),
    (select count(*)::integer from public.review_comments c
      where c.entry_id = e.id and codebox_private.comment_state(c) = 'visible'),
    not codebox_private.entry_is_public(e.id, e.user_id)
  from public.entries e
  join public.users u on u.id = e.user_id
  join public.movies m on m.tmdb_id = e.movie_id
  where e.id = target and codebox_private.review_visible(e.id);
$$;

-- One page of threads, oldest first by (created_at, id), each with its first
-- replies and a count of visible replies. Threads whose top comment isn't visible
-- appear (as "[deleted]" etc.) only while they still have visible replies. Hidden
-- content never leaves the database: body and author are null unless visible.
create function public.review_threads(
  target uuid, after_at timestamptz default null, after_id uuid default null,
  page_size integer default 20, reply_limit integer default 3
)
returns table (
  id uuid, parent_id uuid, author_username text, author_avatar text,
  reply_to_username text, body text, spoiler boolean, state text,
  created_at timestamptz, edited_at timestamptz, reply_count integer, is_mine boolean
)
language sql stable security definer set search_path = '' as $$
  with base as (
    select c.*, codebox_private.comment_state(c) as state
    from public.review_comments c
    where c.entry_id = target and codebox_private.review_visible(target)
  ),
  threads as (
    select t.* from base t
    where t.parent_id is null
      and (after_at is null or (t.created_at, t.id) > (after_at, after_id))
      and (t.state = 'visible' or exists (
        select 1 from base r where r.parent_id = t.id and r.state = 'visible'))
    order by t.created_at, t.id
    limit greatest(1, least(coalesce(page_size, 20), 50)) + 1
  ),
  replies as (
    select r.*,
      row_number() over (partition by r.parent_id order by r.created_at, r.id) as position,
      count(*) over (partition by r.parent_id) as total
    from base r
    where r.parent_id in (select t.id from threads t) and r.state = 'visible'
  ),
  shown as (
    select t.id, t.parent_id, t.user_id, t.reply_to_user_id, t.body, t.spoiler, t.state,
      t.created_at, t.edited_at,
      coalesce((select max(r.total) from replies r where r.parent_id = t.id), 0)::integer as reply_count
    from threads t
    union all
    select r.id, r.parent_id, r.user_id, r.reply_to_user_id, r.body, r.spoiler, r.state,
      r.created_at, r.edited_at, 0
    from replies r where r.position <= greatest(0, least(coalesce(reply_limit, 3), 20))
  )
  select s.id, s.parent_id,
    case when s.state = 'visible' then author.username end,
    case when s.state = 'visible' then author.avatar end,
    case when s.state = 'visible' and codebox_private.not_blocked(s.reply_to_user_id) then replied.username end,
    case when s.state = 'visible' then s.body end,
    s.state = 'visible' and s.spoiler,
    s.state, s.created_at,
    case when s.state = 'visible' then s.edited_at end,
    s.reply_count,
    s.state = 'visible' and s.user_id = auth.uid()
  from shown s
  left join public.users author on author.id = s.user_id
  left join public.users replied on replied.id = s.reply_to_user_id
  order by coalesce((select t.created_at from threads t where t.id = coalesce(s.parent_id, s.id)), s.created_at),
    coalesce(s.parent_id, s.id), s.parent_id nulls first, s.created_at, s.id;
$$;

-- More replies for one thread, oldest first, after a keyset cursor.
create function public.review_replies(
  thread uuid, after_at timestamptz default null, after_id uuid default null,
  page_size integer default 20
)
returns table (
  id uuid, parent_id uuid, author_username text, author_avatar text,
  reply_to_username text, body text, spoiler boolean, state text,
  created_at timestamptz, edited_at timestamptz, reply_count integer, is_mine boolean
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.parent_id, author.username, author.avatar,
    case when codebox_private.not_blocked(r.reply_to_user_id) then replied.username end,
    r.body, r.spoiler, 'visible', r.created_at, r.edited_at, 0, r.user_id = auth.uid()
  from public.review_comments r
  join public.review_comments top on top.id = r.parent_id
  left join public.users author on author.id = r.user_id
  left join public.users replied on replied.id = r.reply_to_user_id
  where r.parent_id = thread and codebox_private.review_visible(top.entry_id)
    and codebox_private.comment_state(r) = 'visible'
    and (after_at is null or (r.created_at, r.id) > (after_at, after_id))
  order by r.created_at, r.id
  limit greatest(1, least(coalesce(page_size, 20), 50)) + 1;
$$;

-- Like or unlike. Only real changes count toward the limit.
create function public.set_review_like(target uuid, should_like boolean)
returns table (is_liked boolean, like_count integer)
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); author uuid;
begin
  if not codebox_private.can_contribute() then
    raise exception 'Verified account and username required' using errcode = '42501';
  end if;
  select e.user_id into author from public.entries e
  where e.id = target and codebox_private.review_visible(e.id);
  if not found then raise exception 'Review unavailable' using errcode = '22023'; end if;
  if author = me then raise exception 'You can''t like your own review' using errcode = '22023'; end if;
  if should_like and not exists (
    select 1 from public.review_likes l where l.entry_id = target and l.user_id = me
  ) then
    perform codebox_private.consume_action_limit('like');
    insert into public.review_likes(entry_id, user_id) values (target, me) on conflict do nothing;
  elsif not should_like and exists (
    select 1 from public.review_likes l where l.entry_id = target and l.user_id = me
  ) then
    perform codebox_private.consume_action_limit('like');
    delete from public.review_likes l where l.entry_id = target and l.user_id = me;
  end if;
  return query select
    exists (select 1 from public.review_likes l where l.entry_id = target and l.user_id = me),
    (select count(*)::integer from public.review_likes l
      where l.entry_id = target and not codebox_private.is_suspended(l.user_id));
end;
$$;

-- Comment or reply. A reply to a reply joins the same top-level thread and records
-- whom it answers. Blocks between the commenter and the review author, the thread
-- author or the person replied to are refused.
create function public.add_review_comment(
  target uuid, comment_text text, is_spoiler boolean default false, reply_to uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  clean text := btrim(coalesce(comment_text, ''));
  author uuid;
  parent public.review_comments%rowtype;
  thread public.review_comments%rowtype;
  answering uuid;
  new_id uuid;
begin
  if not codebox_private.can_contribute() then
    raise exception 'Verified account and username required' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 2000 then
    raise exception 'Comments need 1 to 2,000 characters' using errcode = '22023';
  end if;
  select e.user_id into author from public.entries e
  where e.id = target and codebox_private.review_visible(e.id);
  if not found then raise exception 'Review unavailable' using errcode = '22023'; end if;
  if not codebox_private.not_blocked(author) then
    raise exception 'Comment unavailable' using errcode = '42501';
  end if;
  if reply_to is not null then
    select * into parent from public.review_comments c where c.id = reply_to;
    if not found then raise exception 'That comment no longer exists' using errcode = '22023'; end if;
    if parent.entry_id <> target then
      raise exception 'Replies must belong to the same review' using errcode = '23514';
    end if;
    if parent.parent_id is not null then
      select * into thread from public.review_comments c where c.id = parent.parent_id;
      answering := parent.user_id;
    else
      thread := parent;
    end if;
    -- Blocks first, so a block always reads as "not allowed" (42501).
    if not codebox_private.not_blocked(thread.user_id) or not codebox_private.not_blocked(answering) then
      raise exception 'Reply unavailable' using errcode = '42501';
    end if;
    if codebox_private.comment_state(parent) not in ('visible', 'deleted')
       or (parent.parent_id is not null and codebox_private.comment_state(parent) <> 'visible') then
      raise exception 'That comment is unavailable' using errcode = '22023';
    end if;
  end if;
  perform codebox_private.consume_action_limit('comment');
  insert into public.review_comments(entry_id, user_id, parent_id, reply_to_user_id, body, spoiler)
  values (target, me, thread.id, case when answering is distinct from me then answering end,
    clean, coalesce(is_spoiler, false))
  returning id into new_id;
  return new_id;
end;
$$;

-- Owners edit the text or spoiler flag; changed text is marked edited.
create function public.edit_review_comment(target uuid, comment_text text, is_spoiler boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); clean text := btrim(coalesce(comment_text, ''));
  current public.review_comments%rowtype;
begin
  if not codebox_private.can_contribute() then
    raise exception 'Verified account and username required' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 2000 then
    raise exception 'Comments need 1 to 2,000 characters' using errcode = '22023';
  end if;
  select * into current from public.review_comments c where c.id = target for update;
  if not found or current.user_id is distinct from me or current.deleted_at is not null then
    raise exception 'You can only edit your own comments' using errcode = '42501';
  end if;
  update public.review_comments c set
    body = clean,
    spoiler = coalesce(is_spoiler, false),
    edited_at = case when clean <> current.body then now() else c.edited_at end
  where c.id = target;
end;
$$;

-- Owners delete. A top-level comment with replies becomes "[deleted]" (no body or
-- author); anything else is removed, along with a tombstone left without replies.
create function public.delete_review_comment(target uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); current public.review_comments%rowtype;
begin
  if me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into current from public.review_comments c where c.id = target for update;
  if not found or current.user_id is distinct from me or current.deleted_at is not null then
    raise exception 'You can only delete your own comments' using errcode = '42501';
  end if;
  if current.parent_id is null and exists (
    select 1 from public.review_comments r where r.parent_id = target
  ) then
    update public.review_comments c set body = null, spoiler = false, user_id = null,
      reply_to_user_id = null, deleted_at = now()
    where c.id = target;
  else
    delete from public.review_comments c where c.id = target;
    if current.parent_id is not null then
      delete from public.review_comments c
      where c.id = current.parent_id and c.deleted_at is not null
        and not exists (select 1 from public.review_comments r where r.parent_id = c.id);
    end if;
  end if;
end;
$$;

-- Comment reports join the existing report system.
alter table public.reports
  drop constraint reports_target_kind_check,
  add constraint reports_target_kind_check check (target_kind in ('user', 'review', 'comment')),
  add column target_comment_id uuid references public.review_comments(id) on delete set null;
create unique index reports_one_open_per_comment on public.reports(reporter_id, target_comment_id)
  where status = 'open' and target_kind = 'comment';
grant insert (target_comment_id) on public.reports to authenticated;

create or replace function codebox_private.prepare_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare reviewed public.entries%rowtype; discussed public.review_comments%rowtype;
begin
  perform codebox_private.consume_action_limit('report');
  new.status := 'open';
  new.resolved_at := null;
  if new.target_comment_id is not null then
    select * into discussed from public.review_comments c where c.id = new.target_comment_id;
    if not found or codebox_private.comment_state(discussed) <> 'visible'
       or not codebox_private.review_visible(discussed.entry_id) then
      raise exception 'Only visible comments can be reported' using errcode = '23514';
    end if;
    new.target_kind := 'comment';
    new.target_entry_id := null;
    new.target_user_id := discussed.user_id;
    new.entry_snapshot := jsonb_build_object(
      'entry_id', discussed.entry_id, 'body', discussed.body, 'spoiler', discussed.spoiler,
      'edited_at', discussed.edited_at);
  elsif new.target_entry_id is not null then
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

-- Moderation now covers comments: hide and restore them like reviews.
alter table codebox_private.moderation_actions
  add column target_comment_id uuid references public.review_comments(id) on delete set null;

drop function public.admin_moderate(text, text, uuid, uuid, uuid);
create function public.admin_moderate(
  action text, reason text, report uuid default null,
  target_entry uuid default null, target_user uuid default null, target_comment uuid default null
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
    if action = 'hide' and target_comment is null and target_entry is null then
      target_comment := item.target_comment_id;
      target_entry := item.target_entry_id;
    end if;
    if action = 'suspend' then target_user := coalesce(target_user, item.target_user_id); end if;
  end if;

  if action = 'dismiss' then
    if report is null then raise exception 'Choose a report to dismiss' using errcode = '22023'; end if;
    target_entry := item.target_entry_id;
    target_user := item.target_user_id;
    target_comment := item.target_comment_id;
    update public.reports set status = 'dismissed', resolved_at = now() where id = report;
  elsif action = 'hide' then
    if target_comment is not null then
      if not exists (select 1 from public.review_comments c where c.id = target_comment and c.deleted_at is null) then
        raise exception 'That content no longer exists' using errcode = '22023';
      end if;
      select c.user_id, c.entry_id into target_user, target_entry
      from public.review_comments c where c.id = target_comment;
      insert into codebox_private.hidden_comments(comment_id, action_id) values (target_comment, action_id)
      on conflict (comment_id) do nothing;
    else
      if target_entry is null or not exists (select 1 from public.entries e where e.id = target_entry) then
        raise exception 'That content no longer exists' using errcode = '22023';
      end if;
      select e.user_id into target_user from public.entries e where e.id = target_entry;
      insert into codebox_private.hidden_entries(entry_id, action_id) values (target_entry, action_id)
      on conflict (entry_id) do nothing;
    end if;
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
    if (target_entry is not null)::integer + (target_user is not null)::integer
       + (target_comment is not null)::integer <> 1 then
      raise exception 'Restore one review, comment or account at a time' using errcode = '22023';
    end if;
    if target_comment is not null then
      delete from codebox_private.hidden_comments h where h.comment_id = target_comment;
      if not found then raise exception 'That comment is not hidden' using errcode = '22023'; end if;
      select c.user_id into target_user from public.review_comments c where c.id = target_comment;
    elsif target_entry is not null then
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
  insert into codebox_private.moderation_actions(id, admin_id, action, reason, report_id,
    target_user_id, target_entry_id, target_comment_id)
  values (action_id, me, action, note, report, target_user,
    case when target_comment is null then target_entry end, target_comment);
  return action_id;
end;
$$;

drop function public.admin_reports(public.report_status, integer);
create function public.admin_reports(filter_status public.report_status default 'open', max_rows integer default 50)
returns table (
  id uuid, status public.report_status, reason public.report_reason, details text,
  created_at timestamptz, resolved_at timestamptz, target_kind text,
  reporter_username text, target_user_id uuid, target_username text, target_suspended boolean,
  target_entry_id uuid, entry_hidden boolean, entry_deleted boolean,
  movie_id bigint, movie_title text, entry_score numeric, entry_note text, entry_spoiler boolean,
  target_comment_id uuid, comment_review_id uuid, comment_body text, comment_spoiler boolean,
  comment_hidden boolean, comment_deleted boolean
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
    coalesce(e.movie_id, ce.movie_id, (r.entry_snapshot ->> 'movie_id')::bigint), m.title,
    case when r.target_kind = 'review' then coalesce(e.score, (r.entry_snapshot ->> 'score')::numeric) end,
    case when r.target_kind = 'review' then coalesce(e.note, r.entry_snapshot ->> 'note') end,
    case when r.target_kind = 'review' then coalesce(e.spoiler, (r.entry_snapshot ->> 'spoiler')::boolean) end,
    r.target_comment_id,
    case when r.target_kind = 'comment' then coalesce(c.entry_id, (r.entry_snapshot ->> 'entry_id')::uuid) end,
    case when r.target_kind = 'comment' then coalesce(c.body, r.entry_snapshot ->> 'body') end,
    case when r.target_kind = 'comment' then coalesce(c.spoiler, (r.entry_snapshot ->> 'spoiler')::boolean) end,
    exists (select 1 from codebox_private.hidden_comments h where h.comment_id = r.target_comment_id),
    r.target_kind = 'comment' and (c.id is null or c.deleted_at is not null)
  from public.reports r
  left join public.users reporter on reporter.id = r.reporter_id
  left join public.users target on target.id = r.target_user_id
  left join public.entries e on e.id = r.target_entry_id
  left join public.review_comments c on c.id = r.target_comment_id
  left join public.entries ce on ce.id = c.entry_id
  left join public.movies m on m.tmdb_id = coalesce(e.movie_id, ce.movie_id, (r.entry_snapshot ->> 'movie_id')::bigint)
  where r.status = filter_status
  order by r.created_at desc, r.id desc
  limit greatest(1, least(coalesce(max_rows, 50), 200));
end;
$$;

drop function public.admin_moderation_log(integer);
create function public.admin_moderation_log(max_rows integer default 50)
returns table (
  id uuid, action text, reason text, created_at timestamptz, admin_username text,
  report_id uuid, target_user_id uuid, target_username text, target_entry_id uuid,
  target_comment_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not codebox_private.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
  select a.id, a.action, a.reason, a.created_at, admin.username, a.report_id,
    a.target_user_id, target.username, a.target_entry_id, a.target_comment_id
  from codebox_private.moderation_actions a
  left join public.users admin on admin.id = a.admin_id
  left join public.users target on target.id = a.target_user_id
  order by a.created_at desc, a.id desc
  limit greatest(1, least(coalesce(max_rows, 50), 200));
end;
$$;

-- Account deletion: comments without replies are removed; top-level comments with
-- replies become non-attributed "[deleted]" tombstones so threads survive.
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
  update public.review_comments c set body = null, spoiler = false, user_id = null,
    reply_to_user_id = null, deleted_at = coalesce(c.deleted_at, now())
  where c.user_id = me and c.parent_id is null
    and exists (select 1 from public.review_comments r where r.parent_id = c.id and r.user_id is distinct from me);
  delete from public.review_comments c where c.user_id = me;
  delete from public.users where id = me;
end;
$$;

revoke all on function
  codebox_private.guard_review_comment(), codebox_private.review_visible(uuid),
  codebox_private.comment_state(public.review_comments),
  public.review_details(uuid),
  public.review_threads(uuid, timestamptz, uuid, integer, integer),
  public.review_replies(uuid, timestamptz, uuid, integer),
  public.set_review_like(uuid, boolean),
  public.add_review_comment(uuid, text, boolean, uuid),
  public.edit_review_comment(uuid, text, boolean),
  public.delete_review_comment(uuid),
  public.admin_moderate(text, text, uuid, uuid, uuid, uuid),
  public.admin_reports(public.report_status, integer),
  public.admin_moderation_log(integer)
  from public, anon, authenticated;
grant execute on function public.review_details(uuid),
  public.review_threads(uuid, timestamptz, uuid, integer, integer),
  public.review_replies(uuid, timestamptz, uuid, integer)
  to anon, authenticated, service_role;
grant execute on function public.set_review_like(uuid, boolean),
  public.add_review_comment(uuid, text, boolean, uuid),
  public.edit_review_comment(uuid, text, boolean),
  public.delete_review_comment(uuid),
  public.admin_moderate(text, text, uuid, uuid, uuid, uuid),
  public.admin_reports(public.report_status, integer),
  public.admin_moderation_log(integer)
  to authenticated;
revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;

commit;
