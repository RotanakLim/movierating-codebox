import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { readUsername } from "@/lib/onboarding/profile";
import type { Database } from "@/lib/supabase/database.types";

export type ActionResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

type Contributor =
  | { ok: true; user: User; supabase: SupabaseClient<Database> }
  | { ok: false; error: string };

/**
 * Gate for every social or collection mutation: getUser() (never getSession()), a
 * verified email, a claimed username and an account that isn't suspended. The database enforces the same rule
 * through can_contribute(); this gives the user a clear message first.
 */
export async function requireContributor(): Promise<Contributor> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };
  if (!user.email_confirmed_at)
    return { ok: false, error: "Confirm your email to continue." };
  const supabase = await createClient();
  if (!(await readUsername(supabase, user.id)))
    return { ok: false, error: "Choose a username to continue." };
  const { data: suspended } = await supabase.rpc("my_account_suspended");
  if (suspended === true)
    return {
      ok: false,
      error: "Your account is suspended, so you can't do this right now.",
    };
  return { ok: true, user, supabase };
}
