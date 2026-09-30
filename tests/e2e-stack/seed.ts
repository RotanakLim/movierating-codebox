import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Deterministic data for the stack journeys. Every account is e2e_*, every
// movie id is 990001+, so reseeding never touches anything else.
export const PASSWORD = "correct horse battery 42";
export const MOVIES = {
  arrival: { tmdb_id: 990001, title: "E2E Arrival", year: 2016 },
  heat: { tmdb_id: 990002, title: "E2E Heat", year: 1995 },
  alien: { tmdb_id: 990003, title: "E2E Alien", year: 1979 },
  // Has a poster path; the journeys make the image fail to test the fallback.
  vertigo: {
    tmdb_id: 990004,
    title: "E2E Vertigo",
    year: 1958,
    poster: "/e2e-missing.jpg",
  },
  paprika: { tmdb_id: 990005, title: "E2E Paprika", year: 2006 },
  // Only journey 13 (moderation) touches this one.
  moderated: { tmdb_id: 990006, title: "E2E Moderated", year: 2001 },
  // Only the poster-fallback check uses this one.
  rashomon: {
    tmdb_id: 990007,
    title: "E2E Rashomon",
    year: 1950,
    poster: "/e2e-missing-2.jpg",
  },
} as const;
// Rated by e2e_follower so the community feed has more than one page.
export const FILLER = Array.from({ length: 25 }, (_, index) => ({
  tmdb_id: 990101 + index,
  title: `E2E Filler ${index + 1}`,
  year: 2000 + index,
}));
export const USERS = {
  owner: { username: "e2e_owner", visibility: "public" },
  fan: { username: "e2e_fan", visibility: "public" },
  private: { username: "e2e_private", visibility: "private" },
  guarded: { username: "e2e_guarded", visibility: "followers" },
  follower: { username: "e2e_follower", visibility: "public" },
  blocker: { username: "e2e_blocker", visibility: "public" },
  admin: { username: "e2e_admin", visibility: "public" },
  fresh: { username: "e2e_fresh", visibility: "public" },
} as const;
export type UserKey = keyof typeof USERS;
export const email = (key: UserKey) => `${USERS[key].username}@example.com`;
// The owner's review that discussions, likes and notifications hang off.
export const OWNER_REVIEW = "e2e00000-0000-4000-8000-000000000001";
// The restricted author's public review; the expired-session check comments here.
export const PRIVATE_REVIEW = "e2e00000-0000-4000-8000-000000000002";
// The review journey 13 reports and hides.
export const MODERATED_REVIEW = "e2e00000-0000-4000-8000-000000000003";

export function stackEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !secret || !publishable)
    throw new Error("Run these through `npm run test:e2e:stack`.");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))
    throw new Error("Stack journeys only run against a local Supabase.");
  return { url, secret, publishable };
}

export function admin(): SupabaseClient {
  const { url, secret } = stackEnv();
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A signed-in API client for direct PostgREST/RPC requests (no UI). */
export async function apiAs(key: UserKey) {
  const { url, publishable } = stackEnv();
  const client = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: email(key),
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

export function anonApi() {
  const { url, publishable } = stackEnv();
  return createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Superuser SQL for what the API can't do (admin roles). Local stack only. */
export function sql(query: string): Record<string, unknown>[] {
  const out = execFileSync(
    "npx",
    ["supabase", "db", "query", "--local", query],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // Statements without rows print a command tag (e.g. "INSERT 0 1"), not JSON.
  const start = out.indexOf("{");
  if (start < 0) return [];
  return (JSON.parse(out.slice(start)).rows ?? []) as Record<string, unknown>[];
}

export async function userId(key: UserKey) {
  const { data, error } = await admin()
    .from("users")
    .select("id")
    .eq("username", USERS[key].username)
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function reseed() {
  const db = admin();
  // Remove previous e2e accounts (their content cascades).
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const stale = data.users.filter((user) => user.email?.startsWith("e2e_"));
    for (const user of stale) await db.auth.admin.deleteUser(user.id);
    if (data.users.length < 200) break;
  }
  const { error: movieError } = await db
    .from("movies")
    .upsert([...Object.values(MOVIES), ...FILLER], { onConflict: "tmdb_id" });
  if (movieError) throw movieError;

  const ids = {} as Record<UserKey, string>;
  for (const key of Object.keys(USERS) as UserKey[]) {
    if (key === "fresh") continue; // Created by the sign-up journey.
    const { data, error } = await db.auth.admin.createUser({
      email: email(key),
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    ids[key] = data.user.id;
    const { error: profileError } = await db
      .from("users")
      .update({
        username: USERS[key].username,
        visibility: USERS[key].visibility,
      })
      .eq("id", data.user.id);
    if (profileError) throw profileError;
  }

  const entries = [
    {
      id: OWNER_REVIEW,
      user_id: ids.owner,
      movie_id: MOVIES.arrival.tmdb_id,
      score: 9.1,
      note: "Language as a time machine. The ending lands every time.",
    },
    {
      user_id: ids.owner,
      movie_id: MOVIES.heat.tmdb_id,
      score: 8.4,
      note: "The twist is that McCauley walks away too late.",
      spoiler: true,
    },
    {
      user_id: ids.owner,
      movie_id: MOVIES.alien.tmdb_id,
      score: null,
      note: null,
      watched_date: "2026-01-02",
    },
    // Restricted profile: its rating stays public; its watch date must not leak.
    {
      id: PRIVATE_REVIEW,
      user_id: ids.private,
      movie_id: MOVIES.arrival.tmdb_id,
      score: 7.5,
      note: "Private person, public opinion.",
      watched_date: "2025-12-24",
    },
    {
      user_id: ids.private,
      movie_id: MOVIES.alien.tmdb_id,
      score: null,
      note: null,
      watched_date: "2025-11-11",
    },
    {
      user_id: ids.guarded,
      movie_id: MOVIES.alien.tmdb_id,
      score: null,
      note: null,
    },
    { user_id: ids.fan, movie_id: MOVIES.arrival.tmdb_id, score: 8.0 },
    { user_id: ids.fan, movie_id: MOVIES.vertigo.tmdb_id, score: 6.5 },
    {
      id: MODERATED_REVIEW,
      user_id: ids.owner,
      movie_id: MOVIES.moderated.tmdb_id,
      score: 3.0,
      note: "A review that gets reported.",
    },
    { user_id: ids.admin, movie_id: MOVIES.rashomon.tmdb_id, score: 9.4 },
    ...FILLER.map((movie, index) => ({
      user_id: ids.follower,
      movie_id: movie.tmdb_id,
      score: 5 + (index % 50) / 10,
    })),
  ];
  const { error: entryError } = await db.from("entries").insert(
    entries.map((entry) => ({
      spoiler: false,
      watched: true,
      watched_date: null,
      ...entry,
    })),
    { defaultToNull: false },
  );
  if (entryError) throw entryError;

  // The fan and the follower follow the owner (public: accepted at once).
  for (const key of ["fan", "follower"] as const) {
    const client = await apiAs(key);
    const { error } = await client.rpc("request_follow", {
      target_id: ids.owner,
    });
    if (error) throw error;
  }
  sql(
    `insert into codebox_private.admin_roles(user_id) values ('${ids.admin}') on conflict do nothing`,
  );
  return ids;
}
