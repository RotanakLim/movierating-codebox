"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  block,
  reportReview,
  reportUser,
  unblock,
} from "@/app/profiles/actions";

type Result = { ok: true } | { ok: false; error: string };

/** What blocking does, shown before every block (SPEC section 8). */
export function blockDisclosure(username: string) {
  return `Block @${username}? You'll both stop following each other, pending requests are removed, and you won't see each other's content or interact while signed in. Their public reviews are still visible to anyone who is signed out, and yours are to them. Unblocking later won't restore follows.`;
}

export function BlockConfirm({
  username,
  pending,
  onConfirm,
  onCancel,
}: {
  username: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={`Block @${username}`}
      className="rounded-xl border border-line p-4 text-sm"
    >
      <p>{blockDisclosure(username)}</p>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          className="font-semibold text-red-700 hover:underline dark:text-red-300"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? "Blocking…" : `Block @${username}`}
        </button>
        <button type="button" className="text-muted" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const REASONS = [
  ["spam", "Spam"],
  ["harassment", "Harassment"],
  ["inappropriate", "Inappropriate content"],
  ["spoilers", "Unmarked spoilers"],
  ["other", "Something else"],
] as const;
type Reason = (typeof REASONS)[number][0];

export type ReportTarget =
  | { kind: "user"; userId: string; username: string }
  | { kind: "review"; reviewId: string; username: string };

/** Report a user or a review: a reason, optional details, and a private receipt. */
export function ReportForm({
  target,
  onDone,
  onCancel,
}: {
  target: ReportTarget;
  onDone: (receipt: string) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState<Reason>("spam");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const title =
    target.kind === "user"
      ? `Report @${target.username}`
      : `Report this review by @${target.username}`;
  return (
    <form
      className="space-y-3 rounded-xl border border-line p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const result =
              target.kind === "user"
                ? await reportUser({ userId: target.userId, reason, details })
                : await reportReview({
                    reviewId: target.reviewId,
                    reason,
                    details,
                  });
            if (!result.ok) return setError(result.error);
            onDone(result.receipt);
          } catch {
            setError("That didn't work. Please try again.");
          }
        });
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{title}</legend>
        {REASONS.map(([value, label]) => (
          <label
            key={value}
            className="mb-1 flex items-center gap-2 font-normal"
          >
            <input
              type="radio"
              name={`${id}-reason`}
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
              className="h-4 min-h-0 w-4"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor={`${id}-details`}>Details (optional)</label>
        <textarea
          id={`${id}-details`}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          maxLength={1000}
          rows={3}
          aria-describedby={`${id}-help`}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-base"
        />
        <p id={`${id}-help`} className="mt-1 text-xs text-muted">
          {details.length}/1,000. Only CodeBox moderators see reports; @
          {target.username} never sees who reported them.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-muted">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" className="button-secondary" disabled={pending}>
          {pending ? "Sending…" : "Send report"}
        </button>
        {onCancel && (
          <button
            type="button"
            className="text-sm text-muted"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function receiptMessage(receipt: string) {
  return `Thanks. Your report was received (receipt ${receipt}). Moderators will review it; reports are private.`;
}

/**
 * Report and block controls on a review card, for signed-in viewers other than
 * the author. Blocking hides the author's reviews here at once, with an undo.
 */
export function ReviewSafety({
  reviewId,
  authorId,
  username,
  onBlockChange,
}: {
  reviewId: string;
  authorId: string;
  username: string;
  onBlockChange: (blocked: boolean) => void;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"block" | "report" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<Result>, after: () => void) {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) return setMessage(result.error);
        setPanel(null);
        after();
        router.refresh();
      } catch {
        setMessage("That didn't work. Please try again.");
      }
    });
  }

  const panelContent =
    panel === "report" ? (
      <ReportForm
        target={{ kind: "review", reviewId, username }}
        onCancel={() => setPanel(null)}
        onDone={(receipt) => {
          setPanel(null);
          setMessage(receiptMessage(receipt));
        }}
      />
    ) : panel === "block" ? (
      <BlockConfirm
        username={username}
        pending={pending}
        onCancel={() => setPanel(null)}
        onConfirm={() =>
          run(
            () => block({ userId: authorId }),
            () => onBlockChange(true),
          )
        }
      />
    ) : null;

  return (
    <div className="mt-3 text-xs">
      <div className="flex gap-4">
        <button
          type="button"
          className="text-muted hover:text-ink"
          aria-expanded={panel === "report"}
          onClick={() => setPanel(panel === "report" ? null : "report")}
        >
          Report
        </button>
        <button
          type="button"
          className="text-muted hover:text-ink"
          aria-expanded={panel === "block"}
          onClick={() => setPanel(panel === "block" ? null : "block")}
        >
          Block @{username}
        </button>
      </div>
      {panelContent && <div className="mt-3 text-sm">{panelContent}</div>}
      {message && (
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}

/** Shown in place of a blocked author's reviews, with an undo. */
export function BlockedNotice({
  authorId,
  username,
  onUndo,
}: {
  authorId: string;
  username: string;
  onUndo: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line p-4 text-sm text-muted"
    >
      You blocked @{username}. Their reviews are hidden from you while signed
      in.
      <button
        type="button"
        className="font-semibold text-accent hover:underline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await unblock({ userId: authorId });
              if (!result.ok) return setError(result.error);
              onUndo();
              router.refresh();
            } catch {
              setError("That didn't work. Please try again.");
            }
          })
        }
      >
        {pending ? "Unblocking…" : "Unblock"}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
