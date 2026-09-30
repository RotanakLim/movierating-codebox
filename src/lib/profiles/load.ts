import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/lib/auth/user";
import { getPublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { readUsername } from "@/lib/onboarding/profile";
import { onboardingStepPath } from "@/lib/onboarding/steps";
import {
  COLLECTION_PAGE_SIZE,
  DIARY_PAGE_SIZE,
  type CollectionQuery,
  type CollectionRow,
  type DiaryRow,
  type ListSummary,
  type ListedMovie,
  type ProfileCard,
} from "./types";

/** Owner pages: a signed-in, verified user who has finished onboarding. */
export async function requireOnboardedUser(next: string) {
  const user = await requireUser(next);
  const supabase = await createClient();
  const username = await readUsername(supabase, user.id);
  if (!username) redirect(onboardingStepPath("username", next));
  return { user, username, supabase };
}

/**
 * Identity, privacy mode and the viewer's relationship, or null if unknown.
 * Cached per request: the profile layout and page both call it.
 */
export const loadProfileCard = cache(async function loadProfileCard(
  username: string,
): Promise<ProfileCard | null> {
  if (!getPublicConfig()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("profile_card", {
    target_username: username,
  });
  const row = data?.[0];
  if (error || !row) return null;
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    visibility: row.visibility,
    canView: row.can_view,
    relationship: row.relationship as ProfileCard["relationship"],
    followStatus: row.follow_status,
  };
});

/** Display name and bio; only returned when RLS lets the viewer see the profile. */
export async function loadProfileDetails(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("profile")
    .eq("id", userId)
    .maybeSingle();
  const profile = (data?.profile ?? {}) as {
    display_name?: string;
    bio?: string;
  };
  return {
    displayName: profile.display_name ?? null,
    bio: profile.bio ?? null,
  };
}

/**
 * One row per movie: current score, last known watch date, watch count. Sorting
 * is by value only (never manual); unrated/unknown values sort last, then title,
 * then movie ID for a stable order.
 */
export async function loadCollection(
  userId: string,
  { sort, rated, watched, page }: CollectionQuery,
): Promise<{ rows: CollectionRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  let query = supabase
    .from("user_movie_collection")
    .select(
      "movie_id, title, poster, year, current_score, last_watched_date, watch_count",
    )
    .eq("user_id", userId);
  if (rated) query = query.not("current_score", "is", null);
  if (watched) query = query.gt("watch_count", 0);
  if (sort === "rating-desc" || sort === "rating-asc")
    query = query.order("current_score", {
      ascending: sort === "rating-asc",
      nullsFirst: false,
    });
  if (sort === "latest-watch")
    query = query.order("last_watched_date", {
      ascending: false,
      nullsFirst: false,
    });
  const from = (page - 1) * COLLECTION_PAGE_SIZE;
  const { data, error } = await query
    .order("title", { ascending: true })
    .order("movie_id", { ascending: true })
    .range(from, from + COLLECTION_PAGE_SIZE);
  if (error) throw new Error("The collection is unavailable right now.");
  const rows = (data ?? []).flatMap((row) =>
    row.movie_id && row.title
      ? [
          {
            movieId: row.movie_id,
            title: row.title,
            poster: row.poster,
            year: row.year,
            score: row.current_score,
            lastWatched: row.last_watched_date,
            watchCount: row.watch_count ?? 0,
          },
        ]
      : [],
  );
  return {
    rows: rows.slice(0, COLLECTION_PAGE_SIZE),
    hasMore: rows.length > COLLECTION_PAGE_SIZE,
  };
}

/** Watched entries, newest known watch date first, unknown dates last. */
export async function loadDiary(
  userId: string,
  page: number,
): Promise<{ rows: DiaryRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const from = (page - 1) * DIARY_PAGE_SIZE;
  const { data, error } = await supabase
    .from("entries")
    .select(
      "id, movie_id, score, note, spoiler, watched_date, created_at, movies(title, year)",
    )
    .eq("user_id", userId)
    .eq("watched", true)
    .order("watched_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + DIARY_PAGE_SIZE);
  if (error) throw new Error("The diary is unavailable right now.");
  const rows = (data ?? []).map((row) => ({
    id: row.id,
    movieId: row.movie_id,
    title: row.movies?.title ?? "Unknown movie",
    year: row.movies?.year ?? null,
    score: row.score,
    note: row.note,
    spoiler: row.spoiler,
    watchedDate: row.watched_date,
  }));
  return {
    rows: rows.slice(0, DIARY_PAGE_SIZE),
    hasMore: rows.length > DIARY_PAGE_SIZE,
  };
}

/** The user's watchlist or custom lists, with item counts. */
export async function loadLists(userId: string): Promise<ListSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lists")
    .select("id, kind, name, description, created_at, list_items(count)")
    .eq("user_id", userId)
    .order("kind", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error("Lists are unavailable right now.");
  return (data ?? []).map((list) => ({
    id: list.id,
    kind: list.kind,
    name: list.name,
    description: list.description,
    count: list.list_items[0]?.count ?? 0,
  }));
}

/** One list (RLS: only if the viewer may see its owner's profile) and its movies. */
export async function loadList(listId: string): Promise<{
  list: ListSummary & { userId: string };
  movies: ListedMovie[];
} | null> {
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("lists")
    .select("id, user_id, kind, name, description")
    .eq("id", listId)
    .maybeSingle();
  if (!list) return null;
  const { data, error } = await supabase
    .from("list_items")
    .select("movie_id, added_at, movies(title, poster, year)")
    .eq("list_id", listId)
    .order("added_at", { ascending: false })
    .order("movie_id", { ascending: true });
  if (error) throw new Error("This list is unavailable right now.");
  const movies = (data ?? []).map((item) => ({
    movieId: item.movie_id,
    title: item.movies?.title ?? "Unknown movie",
    poster: item.movies?.poster ?? null,
    year: item.movies?.year ?? null,
    addedAt: item.added_at,
  }));
  return {
    list: {
      id: list.id,
      userId: list.user_id,
      kind: list.kind,
      name: list.name,
      description: list.description,
      count: movies.length,
    },
    movies,
  };
}

export async function watchlistId(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lists")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "watchlist")
    .maybeSingle();
  return data?.id ?? null;
}
