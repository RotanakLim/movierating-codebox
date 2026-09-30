import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Theme } from "./theme";

type Values = { favorite_genre_ids?: number[]; theme?: Theme };

/**
 * Save the signed-in user's private preferences. The owner comes from the
 * verified session, never from the client. Update first and insert only when no
 * row exists (clients cannot update user_id, so PostgREST upsert is not allowed).
 */
export async function savePreferences(
  supabase: SupabaseClient<Database>,
  userId: string,
  values: Values,
): Promise<boolean> {
  const update = () =>
    supabase
      .from("user_preferences")
      .update(values)
      .eq("user_id", userId)
      .select("user_id");
  const { data, error } = await update();
  if (error) return false;
  if (data.length) return true;
  const { error: insertError } = await supabase
    .from("user_preferences")
    .insert({ user_id: userId, ...values });
  if (!insertError) return true;
  // 23505: a concurrent save created the row; retry the update once.
  if (insertError.code !== "23505") return false;
  const { error: retryError } = await update();
  return !retryError;
}
