import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getPublicConfig } from "@/lib/env";

export type RatingSummary = { average: number | null; raters: number };

/**
 * The CodeBox community average from the viewer-independent
 * movie_rating_summary() aggregate. null when it can't be loaded.
 */
export async function loadRatingSummary(
  movieId: number,
): Promise<RatingSummary | null> {
  if (!getPublicConfig()) return null;
  let row;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("movie_rating_summary", {
      target_movie_id: movieId,
    });
    if (error) return null;
    row = data?.[0];
  } catch {
    return null;
  }
  if (!row) return null;
  return {
    average: row.average === null ? null : Number(row.average),
    raters: row.raters,
  };
}
