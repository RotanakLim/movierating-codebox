-- In-app inbox (SPEC section 9): follow request, request accepted, new follower,
-- comment on your review, reply to your comment. Rows are created by triggers on
-- follows and review_comments; clients read and mark them only through functions.
-- Notifications store references, never text: what a viewer sees is rebuilt and
-- re-checked on every read, so spoilers and private data can't be copied in.
begin;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.users(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in
    ('follow_request', 'follow_accepted', 'new_follower', 'review_comment', 'comment_reply')),
  -- One row per event and recipient: follow events are keyed by kind and actor
  -- (a repeat refreshes the row), comment events by the comment (a reply notifies
  -- each recipient at most once, whichever reason applies first).
  event_key text not null,
  entry_id uuid references public.entries(id) on delete cascade,
  comment_id uuid references public.review_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (recipient_id <> actor_id),
  unique (recipient_id, event_key)
);
create index notifications_inbox on public.notifications(recipient_id, created_at desc, id desc);
create index notifications_unread on public.notifications(recipient_id) where read_at is null;
create index notifications_actor on public.notifications(actor_id);
create index notifications_comment on public.notifications(comment_id) where comment_id is not null;
create index notifications_entry on public.notifications(entry_id) where entry_id is not null;
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select, insert, update, delete on public.notifications to service_role;
comment on table public.notifications is 'In-app inbox. References only (no text); written by triggers, read through functions that re-check access.';

-- Create or refresh one notification. Never to yourself, never across a block.
create function codebox_private.notify(
  recipient uuid, actor uuid, event_kind text, key text,
  target_entry uuid default null, target_comment uuid default null, refresh boolean default false
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if recipient is null or actor is null or recipient = actor then return; end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = recipient and b.blocked_id = actor)
       or (b.blocker_id = actor and b.blocked_id = recipient)
  ) then return; end if;
  insert into public.notifications(recipient_id, actor_id, kind, event_key, entry_id, comment_id)
  values (recipient, actor, event_kind, key, target_entry, target_comment)
  on conflict (recipient_id, event_key) do update
    set created_at = now(), read_at = null
    where refresh;
end;
$$;

-- Follow events. A request (pending) notifies the target; approving it notifies
-- the requester; an immediate follow (public profile) notifies the target as a
-- new follower. Handled or withdrawn requests leave the inbox.
create function codebox_private.follow_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.notifications n
    where n.kind = 'follow_request' and n.recipient_id = old.following_id and n.actor_id = old.follower_id;
    return old;
  end if;
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    perform codebox_private.notify(new.following_id, new.follower_id, 'follow_request',
      'follow_request:' || new.follower_id, null, null, true);
  elsif new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    if tg_op = 'UPDATE' and old.status = 'pending' then
      perform codebox_private.notify(new.follower_id, new.following_id, 'follow_accepted',
        'follow_accepted:' || new.following_id, null, null, true);
    else
      perform codebox_private.notify(new.following_id, new.follower_id, 'new_follower',
        'new_follower:' || new.follower_id, null, null, true);
    end if;
  end if;
  if new.status <> 'pending' then
    delete from public.notifications n
    where n.kind = 'follow_request' and n.recipient_id = new.following_id and n.actor_id = new.follower_id;
  end if;
  return new;
end;
$$;
create trigger follows_notify after insert or update of status or delete on public.follows
for each row execute function codebox_private.follow_notifications();

-- Comment events. Replies notify the thread's author and the person replied to
-- ("replied to your comment"), then the review's author ("commented on your
-- review"); the shared event key means each person gets at most one.
create function codebox_private.comment_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare review_author uuid; thread_author uuid; key text := 'comment:' || new.id;
begin
  if new.user_id is null then return new; end if;
  select e.user_id into review_author from public.entries e where e.id = new.entry_id;
  if new.parent_id is not null then
    select c.user_id into thread_author from public.review_comments c where c.id = new.parent_id;
    perform codebox_private.notify(thread_author, new.user_id, 'comment_reply', key, new.entry_id, new.id);
    perform codebox_private.notify(new.reply_to_user_id, new.user_id, 'comment_reply', key, new.entry_id, new.id);
  end if;
  perform codebox_private.notify(review_author, new.user_id, 'review_comment', key, new.entry_id, new.id);
  return new;
end;
$$;
create trigger review_comments_notify after insert on public.review_comments
for each row execute function codebox_private.comment_notifications();

-- Is the notification's target still there for its recipient (the caller)?
create function codebox_private.notification_available(item public.notifications)
returns boolean language sql stable security definer set search_path = '' as $$
  select codebox_private.not_blocked(item.actor_id) and case item.kind
    when 'follow_request' then exists (
      select 1 from public.follows f where f.follower_id = item.actor_id
        and f.following_id = item.recipient_id and f.status = 'pending')
    when 'follow_accepted' then exists (
      select 1 from public.follows f where f.follower_id = item.recipient_id
        and f.following_id = item.actor_id and f.status = 'accepted')
    when 'new_follower' then exists (
      select 1 from public.follows f where f.follower_id = item.actor_id
        and f.following_id = item.recipient_id and f.status = 'accepted')
    else exists (
      select 1 from public.review_comments c
      where c.id = item.comment_id and codebox_private.comment_state(c) = 'visible'
        and codebox_private.review_visible(c.entry_id))
  end;
$$;

-- The caller's inbox, newest first, keyset-paginated by (created_at, id). Pairs
-- with a block are left out. For unavailable targets the actor and movie are
-- withheld, so the app can only say the content is gone.
create function public.my_notifications(
  after_at timestamptz default null, after_id uuid default null, page_size integer default 20
)
returns table (
  id uuid, kind text, created_at timestamptz, is_read boolean, available boolean,
  actor_username text, actor_avatar text, movie_title text
)
language sql stable security definer set search_path = '' as $$
  with page as (
    select n.*, codebox_private.notification_available(n) as ok
    from public.notifications n
    where n.recipient_id = auth.uid() and codebox_private.not_blocked(n.actor_id)
      and (after_at is null or (n.created_at, n.id) < (after_at, after_id))
    order by n.created_at desc, n.id desc
    limit greatest(1, least(coalesce(page_size, 20), 50)) + 1
  )
  select p.id, p.kind, p.created_at, p.read_at is not null, p.ok,
    case when p.ok then a.username end, case when p.ok then a.avatar end,
    case when p.ok then m.title end
  from page p
  join public.users a on a.id = p.actor_id
  left join public.entries e on e.id = p.entry_id
  left join public.movies m on m.tmdb_id = e.movie_id
  order by p.created_at desc, p.id desc;
$$;

create function public.my_unread_notification_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.notifications n
  where n.recipient_id = auth.uid() and n.read_at is null
    and codebox_private.not_blocked(n.actor_id);
$$;

-- Mark some (ids) or all (null) of the caller's notifications read.
create function public.mark_notifications_read(ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  update public.notifications n set read_at = now()
  where n.recipient_id = auth.uid() and n.read_at is null
    and (ids is null or n.id = any(ids));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- Open one: mark it read and re-check the target. Returns nothing for someone
-- else's notification; available = false when the target is gone or restricted.
create function public.open_notification(target uuid)
returns table (kind text, available boolean, actor_username text, entry_id uuid, comment_id uuid)
language plpgsql security definer set search_path = '' as $$
declare item public.notifications%rowtype; ok boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into item from public.notifications n where n.id = target and n.recipient_id = auth.uid();
  if not found then return; end if;
  update public.notifications n set read_at = coalesce(n.read_at, now()) where n.id = item.id;
  ok := codebox_private.notification_available(item);
  return query select item.kind, ok,
    case when ok then (select u.username from public.users u where u.id = item.actor_id) end,
    case when ok then item.entry_id end,
    case when ok then item.comment_id end;
end;
$$;

revoke all on function
  codebox_private.notify(uuid, uuid, text, text, uuid, uuid, boolean),
  codebox_private.follow_notifications(), codebox_private.comment_notifications(),
  codebox_private.notification_available(public.notifications),
  public.my_notifications(timestamptz, uuid, integer), public.my_unread_notification_count(),
  public.mark_notifications_read(uuid[]), public.open_notification(uuid)
  from public, anon, authenticated;
grant execute on function
  public.my_notifications(timestamptz, uuid, integer), public.my_unread_notification_count(),
  public.mark_notifications_read(uuid[]), public.open_notification(uuid)
  to authenticated;

commit;
