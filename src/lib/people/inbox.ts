import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FollowStatus } from "@/lib/profiles/types";

type Client = SupabaseClient<Database>;
export type InboxPerson = {
  id: string;
  username: string;
  avatar: string | null;
  at: string;
};
export type Inbox = {
  requests: InboxPerson[];
  followers: (InboxPerson & { followBack: FollowStatus | null })[];
  sent: InboxPerson[];
};

/** New followers from the last 30 days are shown; older ones live in Settings. */
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The signed-in user's follow inbox, read from real follow rows under RLS:
 * pending requests to them, recent followers (with their own follow-back status),
 * and requests they sent that are still pending. user_identities drops anyone
 * either side has blocked.
 */
export async function loadInbox(supabase: Client, me: string): Promise<Inbox> {
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const [{ data: inbound }, { data: outbound }] = await Promise.all([
    supabase
      .from("follows")
      .select("follower_id, status, updated_at")
      .eq("following_id", me)
      .or(`status.eq.pending,and(status.eq.accepted,updated_at.gte."${since}")`)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("follows")
      .select("following_id, status, updated_at")
      .eq("follower_id", me)
      .in("status", ["pending", "accepted", "declined"])
      .order("updated_at", { ascending: false })
      .limit(500),
  ]);
  const ids = [
    ...new Set([
      ...(inbound ?? []).map((row) => row.follower_id),
      ...(outbound ?? [])
        .filter((row) => row.status === "pending")
        .map((row) => row.following_id),
    ]),
  ];
  const { data: people } = ids.length
    ? await supabase
        .from("user_identities")
        .select("id, username, avatar")
        .in("id", ids)
    : { data: [] };
  const byId = new Map(
    (people ?? []).flatMap((person) =>
      person.id && person.username
        ? [[person.id, { username: person.username, avatar: person.avatar }]]
        : [],
    ),
  );
  const mine = new Map(
    (outbound ?? []).map((row) => [row.following_id, row.status]),
  );
  const person = (id: string, at: string) => {
    const found = byId.get(id);
    return found ? { id, ...found, at } : null;
  };
  return {
    requests: (inbound ?? []).flatMap((row) => {
      const found =
        row.status === "pending" && person(row.follower_id, row.updated_at);
      return found ? [found] : [];
    }),
    followers: (inbound ?? []).flatMap((row) => {
      const found =
        row.status === "accepted" && person(row.follower_id, row.updated_at);
      if (!found) return [];
      const back = mine.get(row.follower_id) ?? null;
      return [{ ...found, followBack: back === "declined" ? null : back }];
    }),
    sent: (outbound ?? []).flatMap((row) => {
      const found =
        row.status === "pending" && person(row.following_id, row.updated_at);
      return found ? [found] : [];
    }),
  };
}
