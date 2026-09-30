import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getPublicConfig } from "@/lib/env";
import { requireContributor } from "@/lib/auth/contributor";
import { limitMovieRequest } from "@/lib/movies/limits";
import { MovieError } from "@/lib/movies/errors";
import {
  AVATAR_MAX_BYTES,
  AvatarError,
  processAvatar,
} from "@/lib/settings/avatar";
import { avatarUrl } from "@/lib/profiles/avatar-url";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers });

async function authorize(request: NextRequest) {
  const config = getPublicConfig();
  if (!config)
    return { response: fail(503, "Avatars are being set up. Try again soon.") };
  // Cookie-authenticated mutation: only the configured origin may submit it.
  if (request.headers.get("origin") !== config.siteUrl)
    return { response: fail(403, "Change your avatar from this website.") };
  const session = await requireContributor();
  if (!session.ok) return { response: fail(401, session.error) };
  return { session };
}

/** Read the body up to the size limit, even when Content-Length is missing. */
async function readBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > AVATAR_MAX_BYTES) {
      await reader.cancel();
      throw new AvatarError(413, "Images can be up to 2 MB.");
    }
    chunks.push(part.value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

type Bucket = ReturnType<Session["supabase"]["storage"]["from"]>;
type Session = Extract<
  Awaited<ReturnType<typeof requireContributor>>,
  { ok: true }
>;

/**
 * Best effort: delete every file in the user's folder except `keep`. This also
 * sweeps files orphaned by concurrent uploads, and keeps the folder under the
 * database's three-file cap. Leftovers are harmless and go with the account.
 */
async function removeOtherFiles(
  bucket: Bucket,
  userId: string,
  keep: string[],
) {
  const { data } = await bucket.list(userId, { limit: 100 });
  const stale = (data ?? [])
    .map((file) => `${userId}/${file.name}`)
    .filter((path) => !keep.includes(path));
  if (stale.length) await bucket.remove(stale);
}

/**
 * Upload a new avatar: the raw image is the request body. It is validated and
 * re-encoded here, stored with the user's own session under `<user id>/`, and
 * every other file in that folder is then removed.
 */
export async function POST(request: NextRequest) {
  const { session, response } = await authorize(request);
  if (!session) return response;
  const { supabase, user } = session;
  let image: Buffer;
  try {
    await limitMovieRequest("avatar", request.headers, user.id);
    image = await processAvatar(await readBody(request));
  } catch (error) {
    if (error instanceof AvatarError) return fail(error.status, error.message);
    if (error instanceof MovieError && error.status === 429)
      return fail(429, "Too many avatar changes. Try again in a while.");
    return fail(503, "Avatar uploads are unavailable. Try again later.");
  }

  const { data: current } = await supabase
    .from("users")
    .select("avatar")
    .eq("id", user.id)
    .single();
  const path = `${user.id}/${crypto.randomUUID()}.webp`;
  const bucket = supabase.storage.from("avatars");
  await removeOtherFiles(
    bucket,
    user.id,
    current?.avatar ? [current.avatar] : [],
  );
  const { error: uploadError } = await bucket.upload(path, image, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError)
    return fail(503, "We couldn't save that image. Please try again.");
  const { error } = await supabase
    .from("users")
    .update({ avatar: path })
    .eq("id", user.id);
  if (error) {
    await bucket.remove([path]);
    return fail(503, "We couldn't save that image. Please try again.");
  }
  await removeOtherFiles(bucket, user.id, [path]);
  revalidatePath("/", "layout");
  return NextResponse.json({ avatar: avatarUrl(path) }, { headers });
}

/** Remove the avatar and go back to the placeholder. */
export async function DELETE(request: NextRequest) {
  const { session, response } = await authorize(request);
  if (!session) return response;
  const { supabase, user } = session;
  const { error } = await supabase
    .from("users")
    .update({ avatar: null })
    .eq("id", user.id);
  if (error) return fail(503, "We couldn't remove your avatar. Try again.");
  await removeOtherFiles(supabase.storage.from("avatars"), user.id, []);
  revalidatePath("/", "layout");
  return NextResponse.json({ avatar: null }, { headers });
}
