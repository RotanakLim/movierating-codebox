"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Result = { ok: true } | { ok: false; error: string };

/**
 * A destructive action behind an inline confirmation: the first click asks, the
 * second runs the server action, then the page refreshes from the server. Focus
 * moves to the confirm button when asked and back to the trigger on Cancel or Escape.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  question,
  action,
  onDone,
  className = "tap-target text-xs font-semibold text-muted hover:text-ink",
}: {
  label: string;
  confirmLabel: string;
  question: string;
  action: () => Promise<Result>;
  onDone?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (asking) confirm.current?.focus();
    else if (returnFocus.current) trigger.current?.focus();
    returnFocus.current = false;
  }, [asking]);
  function dismiss() {
    returnFocus.current = true;
    setAsking(false);
    setError(null);
  }

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) return setError(result.error);
        // If the trigger is still there after the refresh, focus returns to it.
        returnFocus.current = true;
        setAsking(false);
        onDone?.();
        router.refresh();
      } catch {
        setError("That didn't work. Please try again.");
      }
    });
  }

  if (!asking)
    return (
      <button
        ref={trigger}
        type="button"
        className={className}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  return (
    <div
      role="group"
      aria-label={question}
      className="text-xs"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) dismiss();
      }}
    >
      <p className="text-muted">{question}</p>
      <div className="mt-1 flex gap-3">
        <button
          ref={confirm}
          type="button"
          onClick={run}
          disabled={pending}
          className="tap-target font-semibold text-red-700 hover:underline dark:text-red-300"
        >
          {pending ? "Working…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="tap-target text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-muted">
          {error}
        </p>
      )}
    </div>
  );
}
