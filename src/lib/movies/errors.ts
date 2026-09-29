import { NextResponse } from "next/server";
export class MovieError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "MOVIES_UNAVAILABLE",
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function movieErrorResponse(error: unknown) {
  const known =
    error instanceof MovieError
      ? error
      : new MovieError(
          503,
          "Movies are temporarily unavailable. Please try again.",
        );
  return NextResponse.json(
    { error: known.message, code: known.code },
    {
      status: known.status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(known.retryAfter
          ? { "Retry-After": String(known.retryAfter) }
          : {}),
      },
    },
  );
}
