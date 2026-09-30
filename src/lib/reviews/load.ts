import "server-only";
import { createClient } from "@/lib/supabase/server";
import { encodeCursor, type ReviewCursor } from "./cursor";
import type { ReviewPage } from "./types";

export const REVIEW_PAGE_SIZE = 20;

/**
 * One page of public reviews for a movie, newest first, keyset-paginated by
 * (created_at, id). Uses the session client: public_reviews hides authors the
 * viewer blocked or was blocked by. Never selects watch dates or watched status.
 */
export async function loadReviews(
  movieId: number,
  {
    cursor,
    writtenOnly,
  }: { cursor: ReviewCursor | null; writtenOnly: boolean },
): Promise<ReviewPage> {
  const supabase = await createClient();
  let query = supabase
    .from("public_reviews")
    .select("id, user_id, score, note, spoiler, created_at, updated_at")
    .eq("movie_id", movieId);
  if (writtenOnly) query = query.not("note", "is", null);
  if (cursor)
    // Strictly after the cursor row in (created_at desc, id desc) order. Values are
    // quoted because timestamps contain PostgREST's reserved "." and ":".
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`,
    );
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(REVIEW_PAGE_SIZE + 1);
  if (error) throw new Error("Reviews are unavailable.");

  const rows = data.slice(0, REVIEW_PAGE_SIZE);
  const authorIds = [...new Set(rows.flatMap((row) => row.user_id ?? []))];
  const { data: authors, error: authorError } = authorIds.length
    ? await supabase
        .from("user_identities")
        .select("id, username, avatar")
        .in("id", authorIds)
    : { data: [], error: null };
  if (authorError) throw new Error("Reviews are unavailable.");
  const byId = new Map((authors ?? []).map((author) => [author.id, author]));

  const reviews = rows.flatMap((row) => {
    const author = row.user_id ? byId.get(row.user_id) : undefined;
    if (!row.id || !row.created_at || !author?.username) return [];
    return [
      {
        id: row.id,
        author: { username: author.username, avatar: author.avatar },
        score: row.score,
        note: row.note,
        spoiler: row.spoiler ?? false,
        createdAt: row.created_at,
        edited:
          !!row.updated_at &&
          Date.parse(row.updated_at) - Date.parse(row.created_at) > 60_000,
      },
    ];
  });
  const last = rows.at(-1);
  return {
    reviews,
    nextCursor:
      data.length > REVIEW_PAGE_SIZE && last?.created_at && last.id
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
        : null,
  };
}
