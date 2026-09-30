"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContributor, type ActionResult } from "@/lib/auth/contributor";
import { ensureMovieCached } from "@/lib/movies/ensure-cached";
import { MovieError } from "@/lib/movies/errors";

const listFields = z
  .object({
    name: z
      .string()
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1, "Give the list a name.")
          .max(100, "List names can be up to 100 characters."),
      ),
    description: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(500, "Descriptions can be up to 500 characters.")),
  })
  .strict();
const listId = z.uuid();
const movieId = z.number().int().positive().max(2_147_483_647);
const failed = {
  ok: false as const,
  error: "We couldn't save that. Please try again.",
};
const firstIssue = (error: z.ZodError) => ({
  ok: false as const,
  error: error.issues[0].message,
});

function refresh() {
  revalidatePath("/me/lists", "layout");
}

export async function createList(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = listFields.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const session = await requireContributor();
  if (!session.ok) return session;
  // Owner defaults to auth.uid(); RLS only allows kind = 'custom'.
  const { data, error } = await session.supabase
    .from("lists")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description || null,
    })
    .select("id")
    .single();
  if (error || !data) return failed;
  refresh();
  return { ok: true, id: data.id };
}

export async function updateList(input: unknown): Promise<ActionResult> {
  const parsed = listFields.extend({ id: listId }).strict().safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const session = await requireContributor();
  if (!session.ok) return session;
  const { data, error } = await session.supabase
    .from("lists")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
    })
    .eq("id", parsed.data.id)
    .eq("user_id", session.user.id)
    .eq("kind", "custom")
    .select("id");
  if (error) return failed;
  if (!data.length) return { ok: false, error: "That list no longer exists." };
  refresh();
  return { ok: true };
}

export async function deleteList(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: listId }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a list." };
  const session = await requireContributor();
  if (!session.ok) return session;
  // The watchlist can't be deleted: RLS allows deleting custom lists only.
  const { error } = await session.supabase
    .from("lists")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", session.user.id)
    .eq("kind", "custom");
  if (error) return failed;
  refresh();
  return { ok: true };
}

export async function setListMembership(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ listId, movieId, included: z.boolean() })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Choose a list and a movie." };
  const session = await requireContributor();
  if (!session.ok) return session;
  const { supabase, user } = session;
  const { listId: id, movieId: movie, included } = parsed.data;
  // Only the owner's own custom lists; the watchlist has its own toggle.
  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("kind", "custom")
    .maybeSingle();
  if (!list) return { ok: false, error: "That list no longer exists." };
  if (!included) {
    const { error } = await supabase
      .from("list_items")
      .delete()
      .eq("list_id", id)
      .eq("movie_id", movie);
    if (error) return failed;
  } else {
    try {
      await ensureMovieCached(supabase, movie, user.id);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof MovieError && error.status === 404
            ? "This movie is unavailable."
            : "We couldn't add that movie right now.",
      };
    }
    const { error } = await supabase
      .from("list_items")
      .insert({ list_id: id, movie_id: movie });
    if (error && error.code !== "23505") return failed;
  }
  refresh();
  return { ok: true };
}
