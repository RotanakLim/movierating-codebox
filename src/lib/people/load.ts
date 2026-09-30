import "server-only";
import { getPublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { FollowStatus, Visibility } from "@/lib/profiles/types";

export type Person = {
  id: string;
  username: string;
  avatar: string | null;
  visibility: Visibility;
  displayName: string | null;
  followStatus: FollowStatus | null;
};

/** Usernames are lowercase letters, digits and underscores (max 24). */
export function peopleQuery(value: unknown): { term: string; valid: boolean } {
  const term =
    typeof value === "string"
      ? value.trim().replace(/^@/, "").toLowerCase()
      : "";
  return { term, valid: term === "" || /^[a-z0-9_]{1,24}$/.test(term) };
}

/**
 * Username search (any privacy mode; usernames and avatars are always public) or,
 * without a search, public profiles by recent public activity. find_people leaves
 * out blocked and suspended accounts and only returns display names the viewer
 * may see.
 */
export async function findPeople(term: string): Promise<Person[]> {
  if (!getPublicConfig()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_people", {
    ...(term ? { search: term } : {}),
    max_rows: 30,
  });
  if (error) throw new Error("People search is unavailable right now.");
  return (data ?? []).map((row) => ({
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    visibility: row.visibility,
    displayName: row.display_name,
    followStatus: row.follow_status,
  }));
}
