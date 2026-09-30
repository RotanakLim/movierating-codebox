"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContributor, type ActionResult } from "@/lib/auth/contributor";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

const userId = z.uuid();
const failed = {
  ok: false as const,
  error: "That didn't work. Please try again.",
};
const refresh = () => revalidatePath("/", "layout");

/** Follow a profile: accepted at once for public profiles, a request otherwise. */
export async function follow(
  input: unknown,
): Promise<ActionResult<{ status: "accepted" | "pending" | "declined" }>> {
  const parsed = z.object({ userId }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose someone to follow." };
  const session = await requireContributor();
  if (!session.ok) return session;
  const { data, error } = await session.supabase.rpc("request_follow", {
    target_id: parsed.data.userId,
  });
  if (error)
    return {
      ok: false,
      error: error.message.includes("24 hours")
        ? "Your last request was declined. You can ask again after 24 hours."
        : error.code === "42501"
          ? "You can't follow this account."
          : failed.error,
    };
  refresh();
  return { ok: true, status: data };
}

/** Unfollow, or cancel a pending request. */
export async function unfollow(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ userId }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose someone." };
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_follow", {
    other_id: parsed.data.userId,
    direction: "outgoing",
  });
  if (error) return failed;
  refresh();
  return { ok: true };
}

/** Remove someone who follows you (or ignore their pending request). */
export async function removeFollower(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ userId }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose someone." };
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_follow", {
    other_id: parsed.data.userId,
    direction: "incoming",
  });
  if (error) return failed;
  refresh();
  return { ok: true };
}

export async function respondToFollow(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ userId, approve: z.boolean() })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a request." };
  const session = await requireContributor();
  if (!session.ok) return session;
  const { error } = await session.supabase.rpc("respond_follow", {
    requester_id: parsed.data.userId,
    approve: parsed.data.approve,
  });
  if (error) return { ok: false, error: "That request is no longer pending." };
  refresh();
  return { ok: true };
}

/** Block: removes follows both ways; the database trigger does the cleanup. */
export async function block(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ userId }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose someone." };
  const session = await requireContributor();
  if (!session.ok) return session;
  if (parsed.data.userId === session.user.id)
    return { ok: false, error: "You can't block yourself." };
  const { error } = await session.supabase
    .from("blocks")
    .insert({ blocked_id: parsed.data.userId });
  if (error && error.code !== "23505") return failed;
  refresh();
  return { ok: true };
}

export async function unblock(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ userId }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose someone." };
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", parsed.data.userId);
  if (error) return failed;
  refresh();
  return { ok: true };
}

const REPORT_REASONS = [
  "spam",
  "harassment",
  "inappropriate",
  "spoilers",
  "other",
] as const;

/** Report a user. Only admins can read reports; the reporter gets a receipt. */
export async function reportUser(
  input: unknown,
): Promise<ActionResult<{ receipt: string }>> {
  const parsed = z
    .object({
      userId,
      reason: z.enum(REPORT_REASONS),
      details: z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().max(1000, "Details can be up to 1,000 characters.")),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };
  const session = await requireContributor();
  if (!session.ok) return session;
  if (parsed.data.userId === session.user.id)
    return { ok: false, error: "You can't report yourself." };
  // Clients may not read reports, so generate the receipt ID here.
  const receipt = crypto.randomUUID();
  const { error } = await session.supabase.from("reports").insert({
    id: receipt,
    target_user_id: parsed.data.userId,
    reason: parsed.data.reason,
    details: parsed.data.details || null,
  });
  if (error?.code === "23505")
    return {
      ok: false,
      error: "You already have an open report about this account.",
    };
  if (error) return failed;
  return { ok: true, receipt: receipt.slice(0, 8).toUpperCase() };
}

const visibility = z.enum(["public", "followers", "friends", "private"]);
export async function setVisibility(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ visibility }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a privacy setting." };
  const session = await requireContributor();
  if (!session.ok) return session;
  // Accepted relationships are kept; access is re-evaluated on every read.
  const { error } = await session.supabase
    .from("users")
    .update({ visibility: parsed.data.visibility })
    .eq("id", session.user.id);
  if (error) return failed;
  refresh();
  return { ok: true };
}
