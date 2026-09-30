import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { AuditEntry, QueueReport, ReportStatus } from "./types";

/**
 * Admin pages: a signed-in user whose account is in the protected admin_roles
 * table. Everyone else gets a 404, so the page doesn't advertise itself.
 */
export async function requireAdmin(next: string) {
  await requireUser(next);
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc("is_admin");
  if (admin !== true) notFound();
  return supabase;
}

type Client = Awaited<ReturnType<typeof requireAdmin>>;

export async function loadReportQueue(
  supabase: Client,
  status: ReportStatus,
): Promise<QueueReport[]> {
  const { data, error } = await supabase.rpc("admin_reports", {
    filter_status: status,
    max_rows: 100,
  });
  if (error) throw new Error("The report queue is unavailable right now.");
  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    reason: row.reason,
    details: row.details,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    kind:
      row.target_kind === "review" || row.target_kind === "comment"
        ? row.target_kind
        : "user",
    reporter: row.reporter_username,
    targetUserId: row.target_user_id,
    targetUsername: row.target_username,
    targetSuspended: row.target_suspended,
    entryId: row.target_entry_id,
    entryHidden: row.entry_hidden,
    entryDeleted: row.entry_deleted,
    movieId: row.movie_id,
    movieTitle: row.movie_title,
    score: row.entry_score,
    note: row.entry_note,
    spoiler: row.entry_spoiler ?? false,
    commentId: row.target_comment_id,
    commentReviewId: row.comment_review_id,
    commentBody: row.comment_body,
    commentSpoiler: row.comment_spoiler ?? false,
    commentHidden: row.comment_hidden,
    commentDeleted: row.comment_deleted,
  }));
}

export async function loadAuditLog(supabase: Client): Promise<AuditEntry[]> {
  const { data, error } = await supabase.rpc("admin_moderation_log", {
    max_rows: 50,
  });
  if (error) throw new Error("The audit log is unavailable right now.");
  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    reason: row.reason,
    createdAt: row.created_at,
    admin: row.admin_username,
    target: row.target_username,
    entryId: row.target_entry_id,
    commentId: row.target_comment_id,
  }));
}
