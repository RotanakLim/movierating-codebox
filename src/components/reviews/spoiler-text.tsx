"use client";
import { useState } from "react";
import { EyeOff } from "lucide-react";

/**
 * Whole-text spoilers stay out of the DOM (and screen-reader output) until the
 * viewer reveals them. Revealing is local and never affects anyone else.
 */
export function SpoilerText({
  text,
  spoiler,
  kind,
  className = "mt-2 whitespace-pre-line text-sm leading-relaxed",
}: {
  text: string;
  spoiler: boolean;
  kind: "review" | "comment";
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  if (spoiler && !revealed)
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-3 text-sm text-muted">
        <EyeOff size={14} aria-hidden="true" />
        This {kind} contains spoilers.
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="font-semibold text-accent hover:underline"
        >
          Show {kind}
        </button>
      </div>
    );
  return <p className={className}>{text}</p>;
}
