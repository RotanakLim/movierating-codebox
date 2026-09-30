"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/auth/contributor";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { MODERATION_ACTIONS } from "@/lib/admin/types";

const schema = z
  .object({
    action: z.enum(MODERATION_ACTIONS),
    reason: z
      .string()
      .max(5000)
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1, "Give a reason for this action.")
          .max(1000, "Reasons can be up to 1,000 characters."),
      ),
    reportId: z.uuid().nullable(),
    targetEntryId: z.uuid().nullable(),
    targetUserId: z.uuid().nullable(),
  })
  .strict();

/**
 * Dismiss, hide, suspend or restore. The database checks the admin role, requires
 * the reason and writes the audit entry in the same transaction; this action only
 * validates input and uses the signed-in session (never the service role).
 */
export async function moderate(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };
  const supabase = await createClient();
  const { action, reason, reportId, targetEntryId, targetUserId } = parsed.data;
  const { error } = await supabase.rpc("admin_moderate", {
    action,
    reason,
    ...(reportId ? { report: reportId } : {}),
    ...(targetEntryId ? { target_entry: targetEntryId } : {}),
    ...(targetUserId ? { target_user: targetUserId } : {}),
  });
  if (error?.code === "42501") return { ok: false, error: "Admins only." };
  // 22023 messages are written for moderators in the migration.
  if (error?.code === "22023") return { ok: false, error: `${error.message}.` };
  if (error) return { ok: false, error: "That didn't work. Please try again." };
  // Hidden or restored content changes movie pages, profiles and feeds.
  revalidatePath("/", "layout");
  return { ok: true };
}
