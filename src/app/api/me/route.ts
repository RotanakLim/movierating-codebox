import { NextResponse } from "next/server";
import { getPublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { readUsername } from "@/lib/onboarding/profile";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/**
 * The signed-in user's username for the header link. Display only: getClaims
 * verifies the JWT (locally with asymmetric signing keys) but does not detect a
 * revoked session, so nothing here may authorize a read or write.
 */
export async function GET() {
  if (!getPublicConfig())
    return NextResponse.json({ signedIn: false }, { headers });
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return NextResponse.json({ signedIn: false }, { headers });
  const username = await readUsername(supabase, userId);
  return NextResponse.json({ signedIn: true, username }, { headers });
}
