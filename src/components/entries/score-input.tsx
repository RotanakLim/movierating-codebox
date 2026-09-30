"use client";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  SCORE_MAX,
  SCORE_MIN,
  formatScore,
  scoreForFraction,
  scoreForKey,
  scoreLabel,
} from "@/lib/entries/score";

/**
 * Score from 0.0 to 10.0 in 0.1 steps. Mouse and touch: tap or drag the track.
 * Keyboard: arrows ±0.1, Page Up/Down ±1.0, Home 0.0, End 10.0, Delete clears.
 */
export function ScoreInput({
  value,
  onChange,
  disabled = false,
  labelId,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  labelId: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function fromPointer(event: PointerEvent<HTMLDivElement>) {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    onChange(scoreForFraction((event.clientX - box.left) / box.width));
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = scoreForKey(value, event.key);
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
  }
  const percent = value === null ? 0 : (value / SCORE_MAX) * 100;

  return (
    <div className="flex items-center gap-4">
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={labelId}
        aria-valuemin={SCORE_MIN}
        aria-valuemax={SCORE_MAX}
        aria-valuenow={value ?? undefined}
        aria-valuetext={scoreLabel(value)}
        aria-disabled={disabled || undefined}
        onKeyDown={disabled ? undefined : onKeyDown}
        onPointerDown={
          disabled
            ? undefined
            : (event) => {
                dragging.current = true;
                event.currentTarget.setPointerCapture?.(event.pointerId);
                event.currentTarget.focus();
                fromPointer(event);
              }
        }
        onPointerMove={(event) => dragging.current && fromPointer(event)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        className="relative flex h-11 flex-1 cursor-pointer touch-none items-center rounded-full aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        <div ref={track} className="relative h-2 w-full rounded-full bg-line">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${percent}%` }}
          />
          {value !== null && (
            <div
              className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface shadow"
              style={{ left: `${percent}%` }}
            />
          )}
        </div>
      </div>
      <output
        aria-hidden="true"
        className="w-20 text-right font-display text-3xl tabular-nums"
      >
        {value === null ? (
          <span className="text-base text-muted">–</span>
        ) : (
          <>
            {formatScore(value)}
            <span className="text-sm text-muted">/10</span>
          </>
        )}
      </output>
    </div>
  );
}
