"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, LoaderCircle, Plus, Globe, PencilLine } from "lucide-react";
import { saveEntry } from "@/app/entries/actions";
import { ScoreInput } from "./score-input";
import { DeleteEntryButton } from "@/components/profiles/owner-controls";
import {
  claimGuestDraft,
  clearDraft,
  loadDraft,
  saveDraft,
  type Draft,
} from "@/lib/entries/drafts";
import { browserTimeZone, formatDate, todayIn } from "@/lib/entries/dates";
import { formatScore } from "@/lib/entries/score";
import {
  NOTE_MAX_LENGTH,
  entryToEdit,
  type Entry,
  type EntryFields,
  type SaveEntryErrorCode,
} from "@/lib/entries/types";

export type Viewer =
  | { status: "guest" }
  | { status: "unverified"; userId: string }
  | { status: "no-username"; userId: string }
  | { status: "ready"; userId: string };

type Composing = Draft & { restored: boolean };
type Problem = { code: SaveEntryErrorCode | "NETWORK"; text: string };

function describeEntry(entry: Entry) {
  if (!entry.watched) return "not watched";
  return entry.watchedDate
    ? `watched ${formatDate(entry.watchedDate)}`
    : "watched, date unknown";
}

export function EntryComposer({
  movieId,
  movieTitle,
  viewer,
  entries,
  compose,
  opensOn = null,
  serverToday,
  editId = null,
}: {
  movieId: number;
  movieTitle: string;
  viewer: Viewer;
  entries: Entry[];
  compose: "rate" | "log" | null;
  /** Earliest known release date; contributions open that day. */
  opensOn?: string | null;
  /** Today's date on the server, used until the browser's own date is known. */
  serverToday: string;
  /** ?edit=<entry id> from the diary: open that entry. */
  editId?: string | null;
}) {
  const router = useRouter();
  const ids = { score: useId(), note: useId(), date: useId() };
  const owner = viewer.status === "guest" ? null : viewer.userId;
  const [composing, setComposing] = useState<Composing | null>(null);
  const [saving, setSaving] = useState(false);
  // True until the refreshed server render (with the saved entry) has arrived, so
  // "Rate or review" can't act on a stale entry list and create a duplicate.
  const [refreshing, startRefresh] = useTransition();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const restoredOnce = useRef(false);
  const [localToday, setLocalToday] = useState<string | null>(null);
  useEffect(() => setLocalToday(todayIn(browserTimeZone())), []);
  // Unreleased: can be watchlisted but not rated, reviewed or logged yet. The
  // server action re-checks this with the viewer's timezone.
  const notYetReleased = !!opensOn && opensOn > (localToday ?? serverToday);
  const target =
    composing?.targetId != null
      ? (entries.find((entry) => entry.id === composing.targetId) ?? null)
      : null;

  function freshFields(): EntryFields {
    return {
      score: null,
      note: "",
      spoiler: false,
      watched: true,
      watchedDate: todayIn(browserTimeZone()),
    };
  }
  function open(mode: "rate" | "log", entry: Entry | null = null) {
    setProblem(null);
    setSaved(null);
    setToday(todayIn(browserTimeZone()));
    const editing = mode === "rate" ? (entry ?? entryToEdit(entries)) : null;
    setComposing({
      mode,
      targetId: editing?.id ?? null,
      version: editing?.version ?? null,
      clientId: crypto.randomUUID(),
      restored: false,
      fields: editing
        ? {
            score: editing.score,
            note: editing.note ?? "",
            spoiler: editing.spoiler,
            watched: editing.watched,
            watchedDate: editing.watchedDate,
          }
        : freshFields(),
    });
  }

  // Restore an unsent draft (never submit it). After sign-in, a guest's draft for
  // this movie moves to the user's key. ?compose= reopens the composer.
  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    const draft = owner
      ? claimGuestDraft(owner, movieId)
      : loadDraft(null, movieId);
    const requested = editId
      ? entries.find((entry) => entry.id === editId)
      : undefined;
    // An explicit Edit from the diary wins over a draft for a different entry.
    if (requested && draft?.targetId !== requested.id) open("rate", requested);
    else if (draft) {
      setToday(todayIn(browserTimeZone()));
      const stillThere =
        draft.targetId === null ||
        entries.some((entry) => entry.id === draft.targetId);
      setComposing({
        ...draft,
        // An edit whose entry was deleted elsewhere becomes a new entry.
        ...(stillThere ? {} : { targetId: null, version: null }),
        restored: true,
      });
    } else if (compose) open(compose);
    // Runs once on mount; entries/compose come from the server render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft in sessionStorage while composing.
  useEffect(() => {
    if (!composing) return;
    const { mode, targetId, version, clientId, fields } = composing;
    saveDraft(owner, movieId, { mode, targetId, version, clientId, fields });
  }, [composing, owner, movieId]);

  function update(fields: Partial<EntryFields>) {
    setComposing((current) =>
      current ? { ...current, fields: { ...current.fields, ...fields } } : null,
    );
  }
  function cancel() {
    clearDraft(owner, movieId);
    setComposing(null);
    setProblem(null);
  }

  async function submit() {
    if (!composing || saving) return;
    if (viewer.status === "guest") {
      // Keep the draft and come back here after signing in; nothing is submitted.
      const back = `/movies/${movieId}?compose=${composing.mode}`;
      router.push(`/auth/sign-in?next=${encodeURIComponent(back)}`);
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const result = await saveEntry({
        id: composing.targetId ?? composing.clientId,
        movieId,
        expectedVersion: composing.targetId ? composing.version : null,
        timeZone: browserTimeZone(),
        ...composing.fields,
        watchedDate: composing.fields.watched
          ? composing.fields.watchedDate
          : null,
      });
      if (!result.ok) {
        setProblem({ code: result.code, text: result.error });
        return;
      }
      // Confirm only once the server has saved it.
      clearDraft(owner, movieId);
      setComposing(null);
      setSaved(
        composing.targetId
          ? "Your entry was updated."
          : "Your entry was saved.",
      );
      startRefresh(() => router.refresh());
    } catch {
      // Same client UUID on retry, so a create that did reach the server can't
      // be duplicated.
      setProblem({
        code: "NETWORK",
        text: "We couldn't reach CodeBox. Your draft is kept, so try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  const fields = composing?.fields;
  const futureDate =
    !!fields?.watchedDate && !!today && fields.watchedDate > today;
  const noteLength = fields?.note.length ?? 0;

  return (
    <section
      aria-labelledby="your-entries"
      className="mt-9 border-t border-line pt-6"
    >
      <h2 id="your-entries" className="text-sm font-semibold">
        Your rating and review
      </h2>

      {viewer.status === "unverified" && (
        <p className="mt-3 text-sm text-muted">
          <Link href="/auth/verify" className="text-accent underline">
            Confirm your email
          </Link>{" "}
          to rate, review, and log watches.
        </p>
      )}
      {viewer.status === "no-username" && (
        <p className="mt-3 text-sm text-muted">
          <Link
            href={`/onboarding?next=${encodeURIComponent(`/movies/${movieId}`)}`}
            className="text-accent underline"
          >
            Choose a username
          </Link>{" "}
          to rate, review, and log watches.
        </p>
      )}

      {entries.length > 0 && (
        <ul className="mt-4 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-line p-3 text-sm"
            >
              <div className="min-w-0">
                <p>
                  {entry.score !== null && (
                    <strong className="mr-2 tabular-nums">
                      {formatScore(entry.score)}/10
                    </strong>
                  )}
                  <span className="text-muted">{describeEntry(entry)}</span>
                  {entry.spoiler && (
                    <span className="ml-2 text-xs text-muted">· spoilers</span>
                  )}
                </p>
                {entry.note && (
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-muted">
                    {entry.note}
                  </p>
                )}
              </div>
              {viewer.status === "ready" && (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={() => open("rate", entry)}
                    disabled={refreshing}
                    className="text-xs font-semibold text-accent hover:underline"
                    aria-label={`Edit your entry, ${describeEntry(entry)}`}
                  >
                    Edit
                  </button>
                  <DeleteEntryButton entryId={entry.id} title={movieTitle} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {notYetReleased && !composing && (
        <p className="mt-4 rounded-xl border border-line p-4 text-sm text-muted">
          Not released yet. Ratings, reviews and watch logs open on{" "}
          {formatDate(opensOn!)}. You can add it to your watchlist now.
        </p>
      )}
      {!composing && !notYetReleased && (
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            className="button-primary"
            onClick={() => open("rate")}
            disabled={
              refreshing ||
              viewer.status === "unverified" ||
              viewer.status === "no-username"
            }
          >
            <PencilLine size={16} aria-hidden="true" />
            Rate or review
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => open("log")}
            disabled={
              refreshing ||
              viewer.status === "unverified" ||
              viewer.status === "no-username"
            }
          >
            <Plus size={16} aria-hidden="true" />
            Log another watch
          </button>
        </div>
      )}
      {saved && (
        <p role="status" className="mt-4 text-sm text-accent">
          {saved}
        </p>
      )}

      {composing && fields && (
        <form
          className="mt-5 space-y-6 rounded-2xl border border-line bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          aria-label={`Your entry for ${movieTitle}`}
        >
          <p className="text-sm font-semibold" aria-live="polite">
            {target
              ? `Editing your entry: ${describeEntry(target)}`
              : composing.mode === "log"
                ? "Logging another watch (new entry)"
                : "New entry"}
          </p>
          {composing.restored && (
            <p role="status" className="text-xs text-muted">
              We restored your unsaved draft. Nothing is saved until you press
              Save.
            </p>
          )}

          <div>
            <p id={ids.score} className="mb-2 block text-sm font-medium">
              Your score
            </p>
            <ScoreInput
              labelId={ids.score}
              value={fields.score}
              onChange={(score) => update({ score })}
              disabled={saving}
            />
            {fields.score !== null && (
              <button
                type="button"
                className="mt-1 text-xs text-muted hover:text-ink"
                onClick={() => update({ score: null })}
                disabled={saving}
              >
                Clear score
              </button>
            )}
          </div>

          <div>
            <label htmlFor={ids.note}>Review (optional)</label>
            <textarea
              id={ids.note}
              value={fields.note}
              onChange={(event) => update({ note: event.target.value })}
              maxLength={NOTE_MAX_LENGTH}
              rows={5}
              disabled={saving}
              aria-describedby={`${ids.note}-count`}
              className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-base leading-relaxed"
            />
            <p
              id={`${ids.note}-count`}
              className="mt-1 text-right text-xs text-muted"
            >
              {noteLength.toLocaleString("en-US")} /{" "}
              {NOTE_MAX_LENGTH.toLocaleString("en-US")}
            </p>
            <label className="mb-0 mt-2 inline-flex items-center gap-2 font-normal">
              <input
                type="checkbox"
                checked={fields.spoiler}
                onChange={(event) => update({ spoiler: event.target.checked })}
                disabled={saving}
                className="h-5 min-h-0 w-5 accent-[var(--accent)]"
              />
              <Eye size={14} aria-hidden="true" />
              Contains spoilers
            </label>
          </div>

          <fieldset className="space-y-3">
            <legend className="sr-only">Watch details</legend>
            <label className="mb-0 inline-flex items-center gap-2 font-normal">
              <input
                type="checkbox"
                checked={fields.watched}
                onChange={(event) =>
                  update({
                    watched: event.target.checked,
                    watchedDate: event.target.checked ? today : null,
                  })
                }
                disabled={saving}
                className="h-5 min-h-0 w-5 accent-[var(--accent)]"
              />
              I watched this
            </label>
            {fields.watched && (
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label htmlFor={ids.date}>Watch date</label>
                  <input
                    id={ids.date}
                    type="date"
                    value={fields.watchedDate ?? ""}
                    max={today ?? undefined}
                    onChange={(event) =>
                      update({ watchedDate: event.target.value || null })
                    }
                    disabled={saving || fields.watchedDate === null}
                    aria-invalid={futureDate || undefined}
                    aria-describedby={
                      futureDate ? `${ids.date}-error` : undefined
                    }
                    className="w-auto"
                  />
                </div>
                <label className="mb-3 inline-flex items-center gap-2 font-normal">
                  <input
                    type="checkbox"
                    checked={fields.watchedDate === null}
                    onChange={(event) =>
                      update({
                        watchedDate: event.target.checked ? null : today,
                      })
                    }
                    disabled={saving}
                    className="h-5 min-h-0 w-5 accent-[var(--accent)]"
                  />
                  Date unknown
                </label>
              </div>
            )}
            {futureDate && (
              <p id={`${ids.date}-error`} role="alert" className="error">
                The watch date can&apos;t be in the future.
              </p>
            )}
          </fieldset>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <Globe size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            Scores and reviews are public, even if your profile is restricted.
            Watch-only entries follow your profile&apos;s privacy setting.
          </p>

          {problem && (
            <div role="alert" className="error">
              <p>{problem.text}</p>
              {problem.code === "CONFLICT" && (
                <button
                  type="button"
                  className="mt-2 font-semibold underline"
                  onClick={() => {
                    clearDraft(owner, movieId);
                    window.location.reload();
                  }}
                >
                  Reload
                </button>
              )}
              {problem.code === "SIGN_IN_REQUIRED" && (
                <Link
                  className="mt-2 inline-block font-semibold underline"
                  href={`/auth/sign-in?next=${encodeURIComponent(`/movies/${movieId}?compose=${composing.mode}`)}`}
                >
                  Sign in
                </Link>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              className="button-primary"
              disabled={saving || futureDate}
            >
              {saving && (
                <LoaderCircle
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              {saving
                ? "Saving…"
                : viewer.status === "guest"
                  ? "Sign in to save"
                  : "Save"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
