/**
 * The database refuses writes over a per-user limit with SQLSTATE PT429 (HTTP 429
 * through PostgREST), putting the seconds until the limit resets in `details`.
 */
export function rateLimitRetry(
  error: { code?: string; details?: string | null } | null | undefined,
): number | null {
  if (error?.code !== "PT429") return null;
  const seconds = Number.parseInt(error.details ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
}

/** "in 40 seconds", "in 12 minutes", "in about 3 hours". */
export function retryPhrase(seconds: number) {
  if (seconds < 60) return `in ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}
