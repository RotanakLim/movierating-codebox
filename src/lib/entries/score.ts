// The only rating: 0.0–10.0 with exactly one decimal place. Work in integer tenths
// internally so keyboard steps never accumulate floating-point error.
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
const MAX_TENTHS = SCORE_MAX * 10;

export function toTenths(score: number) {
  return Math.round(score * 10);
}
export function fromTenths(tenths: number) {
  return tenths / 10;
}

/** True for 0.0, 0.1, …, 10.0 only: finite, in range, at most one decimal place. */
export function isValidScore(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value < SCORE_MIN || value > SCORE_MAX) return false;
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

export function formatScore(score: number) {
  return fromTenths(toTenths(score)).toFixed(1);
}

/** Screen-reader text, e.g. "9.5 out of 10". */
export function scoreLabel(score: number | null) {
  return score === null ? "Not rated" : `${formatScore(score)} out of 10`;
}

/**
 * Keyboard behaviour for the score slider. Returns the new score, null to clear,
 * or undefined when the key isn't handled. From "not rated", any increase starts
 * at 0.0 so every value from 0.0 to 10.0 is reachable one step at a time.
 */
export function scoreForKey(
  current: number | null,
  key: string,
): number | null | undefined {
  const tenths = current === null ? null : toTenths(current);
  const clamp = (value: number) =>
    fromTenths(Math.min(MAX_TENTHS, Math.max(0, value)));
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return tenths === null ? SCORE_MIN : clamp(tenths + 1);
    case "ArrowLeft":
    case "ArrowDown":
      return tenths === null ? SCORE_MIN : clamp(tenths - 1);
    case "PageUp":
      return tenths === null ? SCORE_MIN : clamp(tenths + 10);
    case "PageDown":
      return tenths === null ? SCORE_MIN : clamp(tenths - 10);
    case "Home":
      return SCORE_MIN;
    case "End":
      return SCORE_MAX;
    case "Delete":
    case "Backspace":
      return null;
    default:
      return undefined;
  }
}

/** Score for a pointer position along the track (0 = left edge, 1 = right edge). */
export function scoreForFraction(fraction: number) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return fromTenths(Math.round(clamped * MAX_TENTHS));
}
