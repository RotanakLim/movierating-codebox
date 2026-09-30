import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { encodeCursor, type ReviewCursor } from "@/lib/reviews/cursor";
import {
  FEED_PAGE_SIZE,
  type FeedItem,
  type FeedPage,
  type FeedTab,
} from "./types";

type Client = SupabaseClient<Database>;
const COLUMNS =
  "id, entry_id, kind, created_at, username, avatar, movie_id, title, poster, year, score";

/**
 * One page of a feed, newest first, keyset-paginated by (created_at, id).
 *   following: people the viewer follows (accepted), including watched-only
 *              events their profiles allow.
 *   community: public ratings and reviews only.
 * Both read through the session client, so RLS removes blocked, hidden,
 * suspended and inaccessible activity. Real rows only; nothing is invented.
 */
export async function loadFeed(
  tab: FeedTab,
  cursor: ReviewCursor | null,
  client?: Client,
): Promise<FeedPage> {
  const supabase = client ?? (await createClient());
  let query =
    tab === "following"
      ? supabase.from("following_feed").select(COLUMNS)
      : supabase
          .from("activity_feed")
          .select(COLUMNS)
          .in("kind", ["rated", "reviewed"]);
  if (cursor)
    // Strictly after the cursor in (created_at desc, id desc) order. Timestamps
    // are quoted because they contain PostgREST's reserved "." and ":".
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`,
    );
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(FEED_PAGE_SIZE + 1);
  if (error) throw new Error("The feed is unavailable right now.");

  const rows = data.slice(0, FEED_PAGE_SIZE);
  const items: FeedItem[] = rows.flatMap((row) =>
    row.id &&
    row.entry_id &&
    row.created_at &&
    row.username &&
    row.movie_id &&
    row.title &&
    row.kind
      ? [
          {
            id: row.id,
            entryId: row.entry_id,
            kind: row.kind,
            createdAt: row.created_at,
            user: { username: row.username, avatar: row.avatar },
            movie: {
              id: row.movie_id,
              title: row.title,
              poster: row.poster,
              year: row.year,
            },
            score: row.score,
          },
        ]
      : [],
  );
  const last = rows.at(-1);
  return {
    items,
    nextCursor:
      data.length > FEED_PAGE_SIZE && last?.created_at && last.id
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
        : null,
  };
}

/** Whether the viewer follows anyone (accepted), which makes Following the default tab. */
export async function followsAnyone(supabase: Client, userId: string) {
  const { count } = await supabase
    .from("follows")
    .select("following_id", { count: "exact", head: true })
    .eq("follower_id", userId)
    .eq("status", "accepted");
  return (count ?? 0) > 0;
}
