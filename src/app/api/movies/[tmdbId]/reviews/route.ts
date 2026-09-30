import { NextResponse, type NextRequest } from "next/server";
import { getPublicConfig } from "@/lib/env";
import { movieId } from "@/lib/movies/validation";
import { decodeCursor } from "@/lib/reviews/cursor";
import { loadReviews } from "@/lib/reviews/load";

export const runtime = "nodejs";
// Viewer-specific (blocks hide authors), so never shared-cached.
const headers = { "Cache-Control": "private, no-store" };

/** GET ?cursor=<opaque>&written=1 — the next page of a movie's public reviews. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tmdbId: string }> },
) {
  if (!getPublicConfig())
    return NextResponse.json(
      { error: "Reviews are not available yet." },
      { status: 503, headers },
    );
  let id: number;
  let cursor;
  try {
    id = movieId((await params).tmdbId);
    cursor = decodeCursor(request.nextUrl.searchParams.get("cursor"));
  } catch {
    return NextResponse.json(
      { error: "Invalid request." },
      { status: 400, headers },
    );
  }
  const writtenOnly = request.nextUrl.searchParams.get("written") === "1";
  try {
    return NextResponse.json(await loadReviews(id, { cursor, writtenOnly }), {
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "Reviews are unavailable right now. Please try again." },
      { status: 503, headers },
    );
  }
}
