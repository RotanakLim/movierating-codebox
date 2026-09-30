import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { encodeCursor, type ReviewCursor } from "@/lib/reviews/cursor";
import {
  NOTIFICATION_PAGE_SIZE,
  type InboxNotification,
  type NotificationKind,
  type NotificationPage,
} from "./types";

type Client = SupabaseClient<Database>;
const KINDS = new Set<NotificationKind>([
  "follow_request",
  "follow_accepted",
  "new_follower",
  "review_comment",
  "comment_reply",
]);

/** The signed-in user's inbox, newest first, with the unread count. */
export async function loadNotifications(
  supabase: Client,
  cursor: ReviewCursor | null,
): Promise<NotificationPage> {
  const [{ data, error }, { data: unread, error: countError }] =
    await Promise.all([
      supabase.rpc("my_notifications", {
        ...(cursor ? { after_at: cursor.createdAt, after_id: cursor.id } : {}),
        page_size: NOTIFICATION_PAGE_SIZE,
      }),
      supabase.rpc("my_unread_notification_count"),
    ]);
  if (error || countError) throw new Error("Notifications are unavailable.");
  const rows = (data ?? []).slice(0, NOTIFICATION_PAGE_SIZE);
  const items: InboxNotification[] = rows.flatMap((row) =>
    KINDS.has(row.kind as NotificationKind)
      ? [
          {
            id: row.id,
            kind: row.kind as NotificationKind,
            createdAt: row.created_at,
            read: row.is_read,
            available: row.available,
            actor:
              row.available && row.actor_username
                ? { username: row.actor_username, avatar: row.actor_avatar }
                : null,
            movieTitle: row.available ? row.movie_title : null,
          },
        ]
      : [],
  );
  const last = rows.at(-1);
  return {
    items,
    nextCursor:
      (data ?? []).length > NOTIFICATION_PAGE_SIZE && last
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
        : null,
    unread: unread ?? 0,
  };
}

/**
 * Open one notification: marks it read, re-checks access in the database, and
 * returns where to go, or null when the target is gone. undefined means the
 * notification isn't the caller's.
 */
export async function openNotification(
  supabase: Client,
  id: string,
): Promise<string | null | undefined> {
  const { data, error } = await supabase.rpc("open_notification", {
    target: id,
  });
  const row = data?.[0];
  if (error || !row) return undefined;
  if (!row.available) return null;
  switch (row.kind) {
    case "follow_request":
      return "/notifications#requests";
    case "follow_accepted":
    case "new_follower":
      return row.actor_username ? `/u/${row.actor_username}` : null;
    case "review_comment":
    case "comment_reply":
      return row.entry_id
        ? `/reviews/${row.entry_id}${row.comment_id ? `#comment-${row.comment_id}` : ""}`
        : null;
    default:
      return null;
  }
}
