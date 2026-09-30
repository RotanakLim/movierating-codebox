import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicConfig } from "@/lib/env";
import type { Database } from "./database.types";

type Admin = SupabaseClient<Database>;

/**
 * Service-role client for account-deletion cleanup only. It never receives user
 * cookies and is never used for ordinary reads or writes.
 */
function createCleanupClient(): Admin | null {
  const config = getPublicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !key) return null;
  return createClient<Database>(config.url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
    },
  });
}

const notFound = (error: { status?: number } | null) => error?.status === 404;

/** Remove every avatar file in the user's folder (repeats until it is empty). */
async function removeAvatars(admin: Admin, userId: string) {
  const bucket = admin.storage.from("avatars");
  for (let round = 0; round < 20; round++) {
    const { data, error } = await bucket.list(userId, { limit: 100 });
    if (error) throw new Error("avatar listing failed");
    if (!data.length) return;
    const { error: removeError } = await bucket.remove(
      data.map((file) => `${userId}/${file.name}`),
    );
    if (removeError) throw new Error("avatar removal failed");
  }
  throw new Error("avatar folder did not empty");
}

/**
 * Step 2 of account deletion (step 1 is request_account_deletion, which already
 * disabled sign-in and removed the profile and its content). Removes the avatar
 * files and the auth identity. Every step is safe to repeat, so a failure simply
 * stays queued; nothing here can make the account visible again.
 */
async function cleanUp(admin: Admin, userId: string) {
  await removeAvatars(admin, userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error && !notFound(error)) throw new Error("auth deletion failed");
}

async function attempt(admin: Admin, userId: string) {
  let failure: string | null = null;
  try {
    await cleanUp(admin, userId);
  } catch (error) {
    // Short, non-identifying reasons only; never log tokens or response bodies.
    failure = error instanceof Error ? error.message : "cleanup failed";
  }
  await admin.rpc("record_account_deletion_attempt", {
    target: userId,
    ...(failure ? { failure } : {}),
  });
  return failure === null;
}

/** Try to finish one account's cleanup right away. Returns false if it stays queued. */
export async function cleanUpDeletedAccount(userId: string) {
  const admin = createCleanupClient();
  if (!admin) return false;
  try {
    return await attempt(admin, userId);
  } catch {
    return false;
  }
}

/** Retry queued cleanups (oldest first). Used by the scheduled job. */
export async function processAccountDeletions(maxRows = 20) {
  const admin = createCleanupClient();
  if (!admin) throw new Error("Account cleanup is not configured.");
  const { data, error } = await admin.rpc("pending_account_deletions", {
    max_rows: maxRows,
  });
  if (error) throw new Error("The deletion queue is unavailable.");
  let completed = 0;
  for (const row of data ?? [])
    if (await attempt(admin, row.user_id)) completed++;
  return { processed: data?.length ?? 0, completed };
}
