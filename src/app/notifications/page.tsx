import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/profiles/load";
import { loadInbox, type InboxPerson } from "@/lib/people/inbox";
import { avatarUrl } from "@/lib/profiles/avatar-url";
import { Avatar } from "@/components/avatar";
import { FollowRequest } from "@/components/settings/controls";
import { NotificationInbox } from "@/components/notifications/inbox";
import { loadNotifications } from "@/lib/notifications/load";
import type { NotificationPage } from "@/lib/notifications/types";
import { FollowButton } from "@/components/profiles/follow-button";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

function when(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function Who({ person }: { person: InboxPerson }) {
  return (
    <Link
      href={`/u/${person.username}`}
      className="flex min-w-0 items-center gap-3 font-semibold hover:text-accent"
    >
      <Avatar src={avatarUrl(person.avatar)} size={36} />
      <span className="truncate">@{person.username}</span>
    </Link>
  );
}

/**
 * The inbox: pending follow requests to act on, then notifications (follows,
 * comments on your reviews, replies to your comments), then requests you sent.
 */
export default async function NotificationsPage() {
  const { user, supabase } = await requireOnboardedUser("/notifications");
  const [inbox, page] = await Promise.all([
    loadInbox(supabase, user.id),
    loadNotifications(supabase, null).catch((): NotificationPage => ({
      items: [],
      nextCursor: null,
      unread: 0,
    })),
  ]);

  return (
    <section className="mx-auto max-w-2xl space-y-12 py-10 sm:py-14">
      <h1 className="font-display text-4xl">Notifications</h1>

      <section
        id="requests"
        aria-labelledby="requests-heading"
        className="scroll-mt-6"
      >
        <h2 id="requests-heading" className="mb-4 text-lg font-semibold">
          Follow requests
        </h2>
        {inbox.requests.length ? (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {inbox.requests.map((person) => (
              <li key={person.id} className="p-4">
                <FollowRequest userId={person.id} username={person.username} />
                <p className="mt-1 text-xs text-muted">
                  Requested {when(person.at)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No pending requests.</p>
        )}
      </section>

      <NotificationInbox initial={page} />

      <section aria-labelledby="sent-heading">
        <h2 id="sent-heading" className="mb-4 text-lg font-semibold">
          Requests you sent
        </h2>
        {inbox.sent.length ? (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {inbox.sent.map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <Who person={person} />
                <FollowButton
                  userId={person.id}
                  username={person.username}
                  initial="pending"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No pending requests.</p>
        )}
      </section>

      <p className="text-sm text-muted">
        All your followers and blocked accounts are in{" "}
        <Link href="/settings#people" className="text-accent underline">
          Settings
        </Link>
        .
      </p>
    </section>
  );
}
