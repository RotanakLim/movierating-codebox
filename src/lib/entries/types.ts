export type Entry = {
  id: string;
  version: number;
  score: number | null;
  note: string | null;
  spoiler: boolean;
  watched: boolean;
  watchedDate: string | null;
  watchedTimezone: string;
  createdAt: string;
};

export type EntryFields = {
  score: number | null;
  note: string;
  spoiler: boolean;
  watched: boolean;
  watchedDate: string | null;
};

export type SaveEntryInput = EntryFields & {
  id: string;
  movieId: number;
  /** null creates the entry; a number updates it only if still at that version. */
  expectedVersion: number | null;
  timeZone: string;
};

export type SaveEntryResult =
  | { ok: true; entry: { id: string; version: number } }
  | {
      ok: false;
      code: SaveEntryErrorCode;
      error: string;
      /** Seconds until a RATE_LIMITED save can be retried. */
      retryAfter?: number;
    };

export type SaveEntryErrorCode =
  | "INVALID"
  | "SIGN_IN_REQUIRED"
  | "VERIFICATION_REQUIRED"
  | "USERNAME_REQUIRED"
  | "CONFLICT"
  | "NOT_RELEASED"
  | "RATE_LIMITED"
  | "SUSPENDED"
  | "UNAVAILABLE";

export const NOTE_MAX_LENGTH = 5000;

/**
 * The entry "Rate or review" edits: the current rated entry (same precedence as
 * current_entries: known watch date, then newest created, then id), otherwise the
 * newest entry, otherwise none.
 */
export function entryToEdit(entries: readonly Entry[]): Entry | null {
  const newestFirst = (a: Entry, b: Entry) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
  const rated = entries
    .filter((entry) => entry.score !== null)
    .sort((a, b) => {
      if (a.watchedDate && b.watchedDate && a.watchedDate !== b.watchedDate)
        return b.watchedDate.localeCompare(a.watchedDate);
      if (Boolean(a.watchedDate) !== Boolean(b.watchedDate))
        return a.watchedDate ? -1 : 1;
      return newestFirst(a, b);
    });
  return rated[0] ?? [...entries].sort(newestFirst)[0] ?? null;
}
