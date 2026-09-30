import "server-only";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { readUsername } from "@/lib/onboarding/profile";
import type { Viewer } from "@/components/entries/entry-composer";
import type { Entry } from "./types";
import type { ListChoice } from "@/components/movies/add-to-lists";

/**
 * The viewer's state, their own entries, and whether the movie is on their
 * watchlist (session client + RLS).
 */
export async function loadViewerEntries(movieId: number): Promise<{
  viewer: Viewer;
  entries: Entry[];
  watchlisted: boolean;
  lists: ListChoice[];
}> {
  const user = await getUser();
  if (!user)
    return {
      viewer: { status: "guest" },
      entries: [],
      watchlisted: false,
      lists: [],
    };
  const supabase = await createClient();
  const [{ data }, username, { data: saved }, { data: custom }] =
    await Promise.all([
      supabase
        .from("entries")
        .select(
          "id, version, score, note, spoiler, watched, watched_date, watched_timezone, created_at",
        )
        .eq("user_id", user.id)
        .eq("movie_id", movieId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      readUsername(supabase, user.id),
      supabase
        .from("list_items")
        .select("movie_id, lists!inner(kind, user_id)")
        .eq("movie_id", movieId)
        .eq("lists.user_id", user.id)
        .eq("lists.kind", "watchlist")
        .limit(1),
      // The viewer's custom lists, each with this movie's item if it's in there.
      supabase
        .from("lists")
        .select("id, name, list_items(movie_id)")
        .eq("user_id", user.id)
        .eq("kind", "custom")
        .eq("list_items.movie_id", movieId)
        .order("created_at", { ascending: true }),
    ]);
  const entries: Entry[] = (data ?? []).map((row) => ({
    id: row.id,
    version: row.version,
    score: row.score,
    note: row.note,
    spoiler: row.spoiler,
    watched: row.watched,
    watchedDate: row.watched_date,
    watchedTimezone: row.watched_timezone,
    createdAt: row.created_at,
  }));
  const viewer: Viewer = !user.email_confirmed_at
    ? { status: "unverified", userId: user.id }
    : !username
      ? { status: "no-username", userId: user.id }
      : { status: "ready", userId: user.id };
  return {
    viewer,
    entries,
    watchlisted: (saved ?? []).length > 0,
    lists: (custom ?? []).map((list) => ({
      id: list.id,
      name: list.name,
      included: list.list_items.length > 0,
    })),
  };
}
