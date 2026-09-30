import "server-only";
import { loadProfileCard } from "@/lib/profiles/load";

/**
 * The profile a /u page may render, or null. Pages check this themselves (the
 * layout renders in parallel), so nothing is queried for a hidden profile.
 */
export async function accessibleProfile(params: Promise<{ username: string }>) {
  const card = await loadProfileCard(
    decodeURIComponent((await params).username),
  );
  return card?.canView ? card : null;
}
