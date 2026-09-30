"use server";
import { z } from "zod";
import { requireContributor, type ActionResult } from "@/lib/auth/contributor";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { rateLimitRetry, retryPhrase } from "@/lib/rate-limit";
import { COMMENT_MAX } from "@/lib/reviews/discussion-types";

const id = z.uuid();
const failed = "That didn't work. Please try again.";
const text = z
  .string()
  .max(COMMENT_MAX * 2)
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(1, "Write something first.")
      .max(COMMENT_MAX, "Comments can be up to 2,000 characters."),
  );

/** Messages for refusals the database makes (limits, blocks, missing content). */
function refusal(
  error: { code?: string; details?: string | null } | null,
  limited: string,
) {
  const retryAfter = rateLimitRetry(error);
  if (retryAfter !== null)
    return `${limited} Try again ${retryPhrase(retryAfter)}.`;
  if (error?.code === "42501") return "You can't do that here.";
  if (error?.code === "22023" || error?.code === "23514")
    return "This review or comment is no longer available.";
  return failed;
}

/** Like or unlike; returns the database's state and count for the optimistic UI. */
export async function setLike(
  input: unknown,
): Promise<ActionResult<{ liked: boolean; count: number }>> {
  const parsed = z
    .object({ reviewId: id, liked: z.boolean() })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a review." };
  const session = await requireContributor();
  if (!session.ok) return session;
  const { data, error } = await session.supabase.rpc("set_review_like", {
    target: parsed.data.reviewId,
    should_like: parsed.data.liked,
  });
  const row = data?.[0];
  if (error || !row)
    return {
      ok: false,
      error:
        error?.code === "22023" && parsed.data.liked
          ? "You can't like this review."
          : refusal(error, "You've changed a lot of likes recently."),
    };
  return { ok: true, liked: row.is_liked, count: row.like_count };
}

/** Comment on a review, or reply (a reply to a reply joins the same thread). */
export async function addComment(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = z
    .object({
      reviewId: id,
      body: text,
      spoiler: z.boolean(),
      replyTo: id.nullable(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };
  const session = await requireContributor();
  if (!session.ok) return session;
  const { data, error } = await session.supabase.rpc("add_review_comment", {
    target: parsed.data.reviewId,
    comment_text: parsed.data.body,
    is_spoiler: parsed.data.spoiler,
    ...(parsed.data.replyTo ? { reply_to: parsed.data.replyTo } : {}),
  });
  if (error || !data)
    return {
      ok: false,
      error: refusal(error, "You've posted a lot of comments recently."),
    };
  return { ok: true, id: data };
}

export async function editComment(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ commentId: id, body: text, spoiler: z.boolean() })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };
  const session = await requireContributor();
  if (!session.ok) return session;
  const { error } = await session.supabase.rpc("edit_review_comment", {
    target: parsed.data.commentId,
    comment_text: parsed.data.body,
    is_spoiler: parsed.data.spoiler,
  });
  if (error) return { ok: false, error: refusal(error, "") };
  return { ok: true };
}

/** Owners delete; a comment with replies stays as "[deleted]" to keep the thread. */
export async function deleteComment(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ commentId: id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a comment." };
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_review_comment", {
    target: parsed.data.commentId,
  });
  if (error) return { ok: false, error: refusal(error, "") };
  return { ok: true };
}
