import Link from "next/link";
import { formatScore } from "@/lib/entries/score";
import { formatDate } from "@/lib/entries/dates";
import type { DiaryRow } from "@/lib/profiles/types";
import { DeleteEntryButton } from "./owner-controls";

/** Watched entries grouped by watch date, with an "Unknown date" group last. */
export function DiaryView({
  rows,
  owner,
  basePath,
  page,
  hasMore,
}: {
  rows: DiaryRow[];
  owner: boolean;
  basePath: string;
  page: number;
  hasMore: boolean;
}) {
  const groups: { date: string | null; rows: DiaryRow[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.date === row.watchedDate) last.rows.push(row);
    else groups.push({ date: row.watchedDate, rows: [row] });
  }
  if (!rows.length)
    return <p className="text-sm text-muted">No watches logged yet.</p>;
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section
          key={group.date ?? "unknown"}
          aria-label={group.date ? formatDate(group.date) : "Unknown date"}
        >
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            {group.date ? formatDate(group.date) : "Unknown date"}
          </h2>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {group.rows.map((row) => (
              <li
                key={row.id}
                className="flex items-start justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/movies/${row.movieId}`}
                    className="font-semibold hover:text-accent"
                  >
                    {row.title}
                  </Link>
                  {row.year && (
                    <span className="text-sm text-muted"> ({row.year})</span>
                  )}
                  <p className="text-sm text-muted">
                    {row.score !== null ? (
                      <strong className="text-ink tabular-nums">
                        {formatScore(row.score)}/10
                      </strong>
                    ) : (
                      "Unrated"
                    )}
                    {row.note && !row.spoiler && (
                      <span className="line-clamp-2 whitespace-pre-line">
                        {row.note}
                      </span>
                    )}
                    {row.note && row.spoiler && (
                      <span className="block italic">
                        Review hidden: spoilers
                      </span>
                    )}
                  </p>
                </div>
                {owner && (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Link
                      href={`/movies/${row.movieId}?edit=${row.id}`}
                      className="text-xs font-semibold text-accent hover:underline"
                    >
                      Edit
                    </Link>
                    <DeleteEntryButton entryId={row.id} title={row.title} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {(page > 1 || hasMore) && (
        <nav aria-label="Pages" className="flex gap-4 text-sm">
          {page > 1 && (
            <Link
              href={`${basePath}?page=${page - 1}`}
              className="button-secondary"
            >
              Newer
            </Link>
          )}
          {hasMore && (
            <Link
              href={`${basePath}?page=${page + 1}`}
              className="button-secondary"
            >
              Older
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
