"use server";
import { z } from "zod";
import type { ActionResult } from "@/lib/auth/contributor";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/** Mark some notifications read, or all of them (ids: null). Own rows only. */
export async function markNotificationsRead(
  input: unknown,
): Promise<ActionResult<{ changed: number }>> {
  const parsed = z
    .object({ ids: z.array(z.uuid()).min(1).max(100).nullable() })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose notifications." };
  if (!(await getUser())) return { ok: false, error: "Sign in to continue." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "mark_notifications_read",
    parsed.data.ids ? { ids: parsed.data.ids } : {},
  );
  if (error) return { ok: false, error: "That didn't work. Please try again." };
  return { ok: true, changed: data ?? 0 };
}
