"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Result = { ok: true } | { ok: false; error: string };

/**
 * A destructive action behind an inline confirmation: the first click asks, the
 * second runs the server action, then the page refreshes from the server.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  question,
  action,
  onDone,
  className = "text-xs font-semibold text-muted hover:text-ink",
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

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) return setError(result.error);
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
        type="button"
        className={className}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  return (
    <div role="group" aria-label={question} className="text-xs">
      <p className="text-muted">{question}</p>
      <div className="mt-1 flex gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="font-semibold text-red-700 hover:underline dark:text-red-300"
        >
          {pending ? "Working…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          disabled={pending}
          className="text-muted hover:text-ink"
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
