export const NOTIFICATION_PAGE_SIZE = 20;
/** The inbox refreshes on window focus and at most this often while it's open. */
export const INBOX_POLL_MS = 60_000;

export type NotificationKind =
  | "follow_request"
  | "follow_accepted"
  | "new_follower"
  | "review_comment"
  | "comment_reply";

/**
 * One inbox item. Built from references only: no review or comment text is ever
 * included, so spoilers can't appear here. When the target is gone or no longer
 * visible, the actor and movie are withheld and `available` is false.
 */
export type InboxNotification = {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  read: boolean;
  available: boolean;
  actor: { username: string; avatar: string | null } | null;
  movieTitle: string | null;
};

export type NotificationPage = {
  items: InboxNotification[];
  nextCursor: string | null;
  unread: number;
};

export const UNAVAILABLE = "This content is no longer available.";

export function notificationText(item: InboxNotification): string {
  if (!item.available || !item.actor) return UNAVAILABLE;
  const who = `@${item.actor.username}`;
  const movie = item.movieTitle ?? "a movie";
  switch (item.kind) {
    case "follow_request":
      return `${who} asked to follow you`;
    case "follow_accepted":
      return `${who} accepted your follow request`;
    case "new_follower":
      return `${who} started following you`;
    case "review_comment":
      return `${who} commented on your review of ${movie}`;
    case "comment_reply":
      return `${who} replied to your comment on a review of ${movie}`;
  }
}
