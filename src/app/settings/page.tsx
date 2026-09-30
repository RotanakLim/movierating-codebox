import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/profiles/load";
import type { Visibility } from "@/lib/profiles/types";
import {
  FollowRequest,
  RemoveFollowerButton,
  UnblockButton,
  VisibilityForm,
} from "@/components/settings/controls";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const { user, supabase } = await requireOnboardedUser("/settings");
  const [{ data: me }, { data: incoming }, { data: blocked }] =
    await Promise.all([
      supabase.from("users").select("visibility").eq("id", user.id).single(),
      supabase
        .from("follows")
        .select("follower_id, status, created_at")
        .eq("following_id", user.id)
        .in("status", ["pending", "accepted"])
        .order("created_at", { ascending: false }),
      supabase.rpc("my_blocked_users"),
    ]);
  const ids = [...new Set((incoming ?? []).map((row) => row.follower_id))];
  const { data: people } = ids.length
    ? await supabase
        .from("user_identities")
        .select("id, username")
        .in("id", ids)
    : { data: [] };
  const names = new Map(
    (people ?? []).flatMap((person) =>
      person.id && person.username ? [[person.id, person.username]] : [],
    ),
  );
  const requests = (incoming ?? []).filter(
    (row) => row.status === "pending" && names.has(row.follower_id),
  );
  const followers = (incoming ?? []).filter(
    (row) => row.status === "accepted" && names.has(row.follower_id),
  );

  return (
    <section className="mx-auto max-w-2xl space-y-10 py-10 sm:py-14">
      <h1 className="font-display text-4xl">Settings</h1>

      <section aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="mb-4 text-lg font-semibold">
          Profile privacy
        </h2>
        <VisibilityForm current={(me?.visibility ?? "public") as Visibility} />
      </section>

      <section aria-labelledby="requests-heading">
        <h2 id="requests-heading" className="mb-4 text-lg font-semibold">
          Follow requests
        </h2>
        {requests.length ? (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {requests.map((row) => (
              <li key={row.follower_id} className="p-4">
                <FollowRequest
                  userId={row.follower_id}
                  username={names.get(row.follower_id)!}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No pending requests.</p>
        )}
      </section>

      <section aria-labelledby="followers-heading">
        <h2 id="followers-heading" className="mb-4 text-lg font-semibold">
          Followers
        </h2>
        {followers.length ? (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {followers.map((row) => {
              const username = names.get(row.follower_id)!;
              return (
                <li
                  key={row.follower_id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <Link href={`/u/${username}`} className="font-medium">
                    @{username}
                  </Link>
                  <RemoveFollowerButton
                    userId={row.follower_id}
                    username={username}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">No followers yet.</p>
        )}
      </section>

      <section aria-labelledby="blocked-heading">
        <h2 id="blocked-heading" className="mb-4 text-lg font-semibold">
          Blocked accounts
        </h2>
        {blocked?.length ? (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {blocked.map((person) => (
              <li
                key={person.id}
                className="flex items-center justify-between gap-3 p-4"
              >
                <span className="font-medium">@{person.username}</span>
                <UnblockButton userId={person.id} username={person.username} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">You haven&apos;t blocked anyone.</p>
        )}
      </section>

      <p className="text-sm text-muted">
        Email, password and sign-out are on your{" "}
        <Link href="/account" className="text-accent underline">
          account page
        </Link>
        .
      </p>
    </section>
  );
}
