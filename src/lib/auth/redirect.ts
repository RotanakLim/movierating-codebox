/** Only local paths may be used after authentication. Never trust callback query parameters. */
export function safeNext(value: unknown, fallback = "/account"): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded))
      return fallback;
    const base = "https://internal.invalid";
    const url = new URL(value, base);
    const normalized = new URL(decoded, base);
    if (
      url.origin !== base ||
      normalized.origin !== base ||
      normalized.pathname === "/auth" ||
      normalized.pathname.startsWith("/auth/")
    )
      return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
