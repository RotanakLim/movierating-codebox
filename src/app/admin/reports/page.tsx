import type { Metadata } from "next";
import Link from "next/link";
import { formatScore } from "@/lib/entries/score";
import { loadAuditLog, loadReportQueue, requireAdmin } from "@/lib/admin/load";
import {
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  queueStatus,
  type QueueReport,
} from "@/lib/admin/types";
import { ModerationControls } from "@/components/admin/moderation-controls";

export const metadata: Metadata = {
  title: "Reports",
  robots: { index: false, follow: false },
};

const STATUS_LABELS = {
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
} as const;

function when(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function Person({ name }: { name: string | null }) {
  return name ? (
    <Link href={`/u/${name}`} className="font-medium hover:text-accent">
      @{name}
    </Link>
  ) : (
    <span className="text-muted">a deleted account</span>
  );
}

function ReportCard({ report }: { report: QueueReport }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <p>
          <strong>
            {REPORT_REASON_LABELS[report.reason] ?? report.reason}
          </strong>
          {" · "}
          {report.kind === "review" ? "Review by " : "Account "}
          <Person name={report.targetUsername} />
          {report.targetSuspended && (
            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
              Suspended
            </span>
          )}
        </p>
        <span className="text-xs text-muted">{when(report.createdAt)} UTC</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Reported by <Person name={report.reporter} />
        {report.resolvedAt && ` · closed ${when(report.resolvedAt)} UTC`}
      </p>
      {report.kind === "review" && (
        <div className="mt-3 rounded-xl border border-line p-3 text-sm">
          <p className="text-xs text-muted">
            {report.movieId ? (
              <Link
                href={`/movies/${report.movieId}`}
                className="hover:text-accent"
              >
                {report.movieTitle ?? `Movie ${report.movieId}`}
              </Link>
            ) : (
              "Unknown movie"
            )}
            {report.score !== null && ` · ${formatScore(report.score)}/10`}
            {report.spoiler && " · marked as spoiler"}
            {report.entryHidden && " · hidden"}
            {report.entryDeleted &&
              " · deleted by its author (snapshot from the report)"}
          </p>
          {report.note ? (
            <p className="mt-2 whitespace-pre-line">{report.note}</p>
          ) : (
            <p className="mt-2 text-muted">Rating only, no written review.</p>
          )}
        </div>
      )}
      {report.details && (
        <p className="mt-3 whitespace-pre-line text-sm">
          <span className="text-muted">Reporter&apos;s details: </span>
          {report.details}
        </p>
      )}
      <ModerationControls report={report} />
    </li>
  );
}

/**
 * Admin-only moderation queue. Access, every action and the audit log are
 * enforced in the database (admin_roles, admin_moderate); this page reads through
 * the signed-in session and shows nothing to anyone else.
 */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const status = queueStatus((await searchParams).status);
  const supabase = await requireAdmin(
    `/admin/reports${status === "open" ? "" : `?status=${status}`}`,
  );
  const [reports, audit] = await Promise.all([
    loadReportQueue(supabase, status),
    loadAuditLog(supabase),
  ]);

  return (
    <section className="mx-auto max-w-3xl py-10 sm:py-14">
      <p className="eyebrow mb-4">ADMIN</p>
      <h1 className="font-display text-4xl">Reports</h1>
      <nav aria-label="Report status" className="mt-6 flex gap-5 text-sm">
        {REPORT_STATUSES.map((item) => (
          <Link
            key={item}
            href={
              item === "open"
                ? "/admin/reports"
                : `/admin/reports?status=${item}`
            }
            aria-current={item === status ? "page" : undefined}
            className={
              item === status
                ? "font-semibold text-ink"
                : "text-muted hover:text-ink"
            }
          >
            {STATUS_LABELS[item]}
          </Link>
        ))}
      </nav>

      {reports.length ? (
        <ul className="mt-6 space-y-4">
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </ul>
      ) : (
        <p className="mt-8 text-sm text-muted">
          No {STATUS_LABELS[status].toLowerCase()} reports.
        </p>
      )}

      <section aria-labelledby="audit-heading" className="mt-14">
        <h2 id="audit-heading" className="text-lg font-semibold">
          Recent moderation actions
        </h2>
        {audit.length ? (
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line text-sm">
            {audit.map((entry) => (
              <li key={entry.id} className="p-4">
                <p>
                  <strong className="capitalize">{entry.action}</strong>
                  {entry.entryId ? " review by " : " "}
                  {entry.target ? `@${entry.target}` : "a deleted account"}
                  <span className="text-muted">
                    {" "}
                    · {entry.admin
                      ? `@${entry.admin}`
                      : "a former admin"} · {when(entry.createdAt)} UTC
                  </span>
                </p>
                <p className="mt-1 text-muted">{entry.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted">No actions yet.</p>
        )}
      </section>
    </section>
  );
}
