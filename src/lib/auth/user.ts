import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicConfig } from "@/lib/env";
export async function getUser() {
  // Session reads are per-request. Opt out of prerendering even when Supabase is
  // unconfigured at build time, or a signed-out page would be baked in statically.
  await connection();
  if (!getPublicConfig()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}
export async function requireUser(next = "/account") {
  const user = await getUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  if (!user.email_confirmed_at) redirect("/auth/verify");
  return user;
}
