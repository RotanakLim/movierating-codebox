"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderate } from "@/app/admin/actions";
import type { ModerationAction, QueueReport } from "@/lib/admin/types";

type Choice = {
  key: string;
  label: string;
  action: ModerationAction;
  targetEntryId: string | null;
  targetUserId: string | null;
  explain: string;
};

/** The actions that make sense for a report in its current state. */
export function choicesFor(report: QueueReport): Choice[] {
  const choices: Choice[] = [];
  const open = report.status === "open";
  const who = report.targetUsername ? `@${report.targetUsername}` : "account";
  if (open)
    choices.push({
      key: "dismiss",
      label: "Dismiss",
      action: "dismiss",
      targetEntryId: null,
      targetUserId: null,
      explain: "Close this report without changing any content.",
    });
  if (
    open &&
    report.kind === "review" &&
    report.entryId &&
    !report.entryHidden &&
    !report.entryDeleted
  )
    choices.push({
      key: "hide",
      label: "Hide review",
      action: "hide",
      targetEntryId: report.entryId,
      targetUserId: null,
      explain:
        "Removes the review from movie pages, feeds, profiles and the community average. The author still sees it.",
    });
  if (open && report.targetUserId && !report.targetSuspended)
    choices.push({
      key: "suspend",
      label: `Suspend ${who}`,
      action: "suspend",
      targetEntryId: null,
      targetUserId: report.targetUserId,
      explain:
        "Hides all of their reviews and ratings from everyone else and stops them posting, reporting or following until restored.",
    });
  if (report.entryId && report.entryHidden)
    choices.push({
      key: "restore-entry",
      label: "Restore review",
      action: "restore",
      targetEntryId: report.entryId,
      targetUserId: null,
      explain: "Makes the hidden review public again.",
    });
  if (report.targetUserId && report.targetSuspended)
    choices.push({
      key: "restore-user",
      label: `Restore ${who}`,
      action: "restore",
      targetEntryId: null,
      targetUserId: report.targetUserId,
      explain: "Lifts the suspension; their public content returns.",
    });
  return choices;
}

/** Pick an action, give the required reason, confirm. Every action is audited. */
export function ModerationControls({ report }: { report: QueueReport }) {
  const id = useId();
  const router = useRouter();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [pending, startTransition] = useTransition();
  const choices = choicesFor(report);
  if (!choices.length) return null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap gap-2">
        {choices.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={choice?.key === item.key}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              choice?.key === item.key
                ? "border-accent bg-accent/10"
                : "border-line text-muted hover:text-ink"
            }`}
            onClick={() => {
              setChoice(choice?.key === item.key ? null : item);
              setMessage(undefined);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {choice && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(undefined);
            startTransition(async () => {
              try {
                const result = await moderate({
                  action: choice.action,
                  reason,
                  // Restores name their target directly; the rest act on the report.
                  reportId: choice.action === "restore" ? null : report.id,
                  targetEntryId: choice.targetEntryId,
                  targetUserId: choice.targetUserId,
                });
                if (!result.ok)
                  return setMessage({ text: result.error, error: true });
                setMessage({
                  text: `${choice.label}: done and recorded.`,
                  error: false,
                });
                setChoice(null);
                setReason("");
                router.refresh();
              } catch {
                setMessage({
                  text: "That didn't work. Please try again.",
                  error: true,
                });
              }
            });
          }}
        >
          <p className="text-sm text-muted">{choice.explain}</p>
          <div>
            <label htmlFor={`${id}-reason`}>Reason (required, audited)</label>
            <textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              rows={2}
              required
            />
          </div>
          <button
            type="submit"
            className={
              choice.action === "hide" || choice.action === "suspend"
                ? "button-danger"
                : "button-secondary"
            }
            disabled={pending || !reason.trim()}
          >
            {pending ? "Saving…" : `Confirm: ${choice.label}`}
          </button>
        </form>
      )}
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={message.error ? "error mt-3" : "mt-3 text-sm text-muted"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
