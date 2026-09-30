"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireContributor, type ActionResult } from "@/lib/auth/contributor";
import { getUser } from "@/lib/auth/user";
import { isRecent, lastAuthenticatedAt } from "@/lib/auth/recent";
import { createClient } from "@/lib/supabase/server";
import { cleanUpDeletedAccount } from "@/lib/supabase/account-cleanup";
import { readUsername } from "@/lib/onboarding/profile";
import { limitMovieRequest } from "@/lib/movies/limits";
import { MovieError } from "@/lib/movies/errors";
import { savePreferences } from "@/lib/settings/preferences";
import { THEMES } from "@/lib/settings/theme";

const SIGN_IN_AGAIN =
  "For your security, sign in again before deleting your account.";
const failed = {
  ok: false as const,
  error: "That didn't work. Please try again.",
};

/** Trim, fold runs of spaces and drop control characters (keeping bio line breaks). */
const text = (max: number, label: string, multiline = false) =>
  z
    .string()
    .max(2000, `${label} can be up to ${max} characters.`)
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .replace(multiline ? /[^\S\n]+/g : /\s+/g, " ")
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .pipe(z.string().max(max, `${label} can be up to ${max} characters.`));

const profileSchema = z
  .object({
    displayName: text(60, "Display name"),
    bio: text(300, "Bio", true),
  })
  .strict();

/** Display name and bio. Empty fields are removed rather than stored blank. */
export async function saveProfile(input: unknown): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };
  const session = await requireContributor();
  if (!session.ok) return session;
  const { displayName, bio } = parsed.data;
  const { error } = await session.supabase
    .from("users")
    .update({
      profile: {
        ...(displayName ? { display_name: displayName } : {}),
        ...(bio ? { bio } : {}),
      },
    })
    .eq("id", session.user.id);
  if (error) return failed;
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The account copy of the theme; the browser keeps its own for first paint. */
export async function saveTheme(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ theme: z.enum(THEMES) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a theme." };
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in to save your theme." };
  const supabase = await createClient();
  // Accounts without a profile row yet (mid-onboarding) keep the local choice only.
  if (!(await readUsername(supabase, user.id))) return { ok: true };
  if (!(await savePreferences(supabase, user.id, { theme: parsed.data.theme })))
    return failed;
  return { ok: true };
}

/**
 * Confirm the password again before account deletion. A successful sign-in
 * replaces the session, which records a fresh authentication time.
 */
export async function reauthenticate(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ password: z.string().min(1).max(128) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter your password." };
  const user = await getUser();
  if (!user?.email) return { ok: false, error: "Sign in to continue." };
  try {
    // Supabase Auth only sees this server's IP, so limit guesses per account too.
    await limitMovieRequest("reauth", await headers(), user.id);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof MovieError && error.status === 429
          ? "Too many attempts. Please wait 15 minutes and try again."
          : "Password check is unavailable right now. Please try again.",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.password,
  });
  if (error)
    return {
      ok: false,
      error:
        error.status === 429
          ? "Too many attempts. Please wait and try again."
          : "That password isn't right.",
    };
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Permanently delete the signed-in account. Requires a sign-in within the last
 * few minutes and the username typed as confirmation; the database enforces both
 * again, so calling its RPC directly can't skip them. It disables sign-in and
 * removes the profile and its content at once. Avatar files and the auth
 * identity are removed after the response, or by the scheduled retry.
 */
export async function deleteAccount(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ confirmation: z.string().max(100) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Type your username." };
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };
  const supabase = await createClient();
  const username = await readUsername(supabase, user.id);
  if (!username) return { ok: false, error: "Choose a username to continue." };
  if (parsed.data.confirmation.trim().toLowerCase() !== username)
    return { ok: false, error: "Type your username to confirm." };
  if (!isRecent(await lastAuthenticatedAt(supabase)))
    return { ok: false, error: SIGN_IN_AGAIN };
  const { error } = await supabase.rpc("request_account_deletion", {
    confirmation: parsed.data.confirmation,
  });
  if (error?.code === "42501") return { ok: false, error: SIGN_IN_AGAIN };
  if (error?.code === "22023")
    return { ok: false, error: "Type your username to confirm." };
  if (error) return failed;
  // The sessions are already gone server-side; this clears the cookies.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  // Don't make the user wait on Storage and Auth; failures stay queued.
  const userId = user.id;
  after(() => cleanUpDeletedAccount(userId));
  revalidatePath("/", "layout");
  redirect("/account/deleted");
}
