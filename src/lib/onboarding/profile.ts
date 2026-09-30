import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { onboardingStepPath } from "./steps";

type Client = SupabaseClient<Database>;

/** The signed-in user's username, or null when onboarding has not claimed one. */
export async function readUsername(
  supabase: Client,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("users")
    .select("username")
    .eq("id", userId)
    .maybeSingle();
  return data?.username ?? null;
}

/** Where to send a user who just authenticated: onboarding first if needed. */
export async function destinationAfterAuth(
  next: string,
  supabase?: Client,
): Promise<string> {
  const client = supabase ?? (await createClient());
  // getUser (not getSession): this decides where an authenticated user goes.
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return next;
  if (await readUsername(client, data.user.id)) return next;
  return onboardingStepPath("username", next);
}
