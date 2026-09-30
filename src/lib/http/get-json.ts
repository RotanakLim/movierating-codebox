// Client-side GET for the app's JSON routes. Every failure becomes an Error with
// a message that's safe to show: offline, an expired session, a rate limit, or
// the route's own error text. Non-JSON bodies (a proxy error page) never leak.
// The request uses the default cache mode: private routes answer `no-store`
// themselves, and public ones (search) can then be served from HTTP caches.
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
  get signedOut() {
    return this.status === 401;
  }
}

export async function getJson<T>(
  url: string,
  fallback: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    // A cancelled request isn't a connection problem; let the caller ignore it.
    if (signal?.aborted) throw error;
    throw new RequestError(
      "You seem to be offline. Check your connection and try again.",
      0,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && body !== null) return body as T;
  const error =
    body && typeof body === "object" && "error" in body
      ? (body as { error: unknown }).error
      : null;
  if (response.status === 401)
    throw new RequestError(
      "Your session has ended. Sign in again to continue.",
      401,
    );
  throw new RequestError(
    typeof error === "string" ? error : fallback,
    response.status,
  );
}
