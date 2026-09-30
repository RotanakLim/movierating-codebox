import "server-only";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { readUsername } from "@/lib/onboarding/profile";
import type { Viewer } from "@/components/entries/entry-composer";
import type { Entry } from "./types";

/** The viewer's state and their own entries for one movie (session client + RLS). */
export async function loadViewerEntries(
  movieId: number,
): Promise<{ viewer: Viewer; entries: Entry[] }> {
  const user = await getUser();
  if (!user) return { viewer: { status: "guest" }, entries: [] };
  const supabase = await createClient();
  const [{ data }, username] = await Promise.all([
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
  return { viewer, entries };
}
