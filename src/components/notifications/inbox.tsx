"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { LoadError } from "@/components/load-error";
import { notifyProfileChanged } from "@/components/profile-link";
import { getJson } from "@/lib/http/get-json";
import { markNotificationsRead } from "@/app/notifications/actions";
import { avatarUrl } from "@/lib/profiles/avatar-url";
import {
  INBOX_POLL_MS,
  notificationText,
  type InboxNotification,
  type NotificationPage,
} from "@/lib/notifications/types";

function when(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function fetchPage(cursor?: string | null) {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
  return getJson<NotificationPage>(
    `/api/notifications${query}`,
    "Notifications are unavailable right now.",
  );
}

/**
 * The inbox. It refreshes when the window regains focus and every 60 seconds,
 * only while this page is open; nothing polls elsewhere. Opening an item goes
 * through /notifications/[id], which re-checks access before showing anything.
 */
export function NotificationInbox({ initial }: { initial: NotificationPage }) {
  const [items, setItems] = useState<InboxNotification[]>(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [unread, setUnread] = useState(initial.unread);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const unreadRef = useRef(initial.unread);

  // Merge the newest page in at the top; keep older pages already loaded.
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const page = await fetchPage();
      setItems((current) => {
        const fresh = new Map(page.items.map((item) => [item.id, item]));
        const older = current.filter((item) => !fresh.has(item.id));
        const cutoff = page.items.at(-1)?.createdAt;
        return [
          ...page.items,
          ...older.filter((item) => !cutoff || item.createdAt < cutoff),
        ];
      });
      // Refresh the nav badge only when the count actually changed.
      if (unreadRef.current !== page.unread) notifyProfileChanged();
      unreadRef.current = page.unread;
      setUnread(page.unread);
      setError(null);
    } catch {
      // A missed poll is harmless; the next focus or tick tries again.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, INBOX_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  function mark(ids: string[] | null) {
    setError(null);
    startTransition(async () => {
      const result = await markNotificationsRead({ ids }).catch(() => ({
        ok: false as const,
        error: "That didn't work. Please try again.",
      }));
      if (!result.ok) return setError(new Error(result.error));
      setItems((current) =>
        current.map((item) =>
          ids === null || ids.includes(item.id)
            ? { ...item, read: true }
            : item,
        ),
      );
      unreadRef.current =
        ids === null ? 0 : Math.max(0, unreadRef.current - result.changed);
      setUnread(unreadRef.current);
      notifyProfileChanged();
    });
  }

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const page = await fetchPage(nextCursor);
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="activity-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="activity-heading" className="text-lg font-semibold">
          Activity{" "}
          <span className="text-sm font-normal text-muted">
            ({unread} unread)
          </span>
        </h2>
        {unread > 0 && (
          <button
            type="button"
            className="text-sm font-semibold text-accent hover:underline"
            disabled={pending}
            onClick={() => mark(null)}
          >
            Mark all read
          </button>
        )}
      </div>
      {error !== null && <LoadError error={error} className="mb-3" />}
      {items.length ? (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {items.map((item) => (
            <li
              key={item.id}
              className={`flex items-start gap-3 p-4 ${item.read ? "" : "bg-accent/5"}`}
            >
              {item.actor ? (
                <Avatar src={avatarUrl(item.actor.avatar)} size={36} />
              ) : (
                <span className="h-9 w-9 shrink-0 rounded-full bg-line/60" />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  href={`/notifications/${item.id}`}
                  className={`block text-sm hover:text-accent ${item.read ? "text-muted" : "font-semibold text-ink"}`}
                >
                  {!item.read && <span className="sr-only">Unread: </span>}
                  {notificationText(item)}
                </Link>
                <p className="mt-1 text-xs text-muted">
                  {when(item.createdAt)} UTC
                </p>
              </div>
              {!item.read && (
                <button
                  type="button"
                  className="tap-target shrink-0 text-xs text-muted hover:text-ink"
                  disabled={pending}
                  onClick={() => mark([item.id])}
                  aria-label={`Mark read: ${notificationText(item)}`}
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          No notifications yet. Follows, comments on your reviews and replies to
          your comments will show up here.
        </p>
      )}
      {nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="button-secondary mt-4"
        >
          {loading && (
            <LoaderCircle
              size={16}
              className="animate-spin"
              aria-hidden="true"
            />
          )}
          {loading ? "Loading…" : error !== null ? "Try again" : "Load older"}
        </button>
      )}
    </section>
  );
}
