"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { cacheMovie } from "@/lib/supabase/movie-cache";
import { getMovieDetails } from "@/lib/movies/tmdb";
import { limitMovieRequest } from "@/lib/movies/limits";
import { MovieError } from "@/lib/movies/errors";
import { MOVIE_GENRES } from "@/lib/movies/types";
import { readUsername } from "@/lib/onboarding/profile";
import { savePreferences } from "@/lib/settings/preferences";
import {
  FAVORITE_MOVIE_LIMIT,
  onboardingStepPath,
} from "@/lib/onboarding/steps";
import {
  USERNAME_MESSAGES,
  localUsernameStatus,
  type UsernameStatus,
} from "@/lib/onboarding/username";
import { usernameSchema } from "@/lib/onboarding/username-schema";

export type OnboardingState = { error?: string; saved?: boolean };

const genreIds = new Set<number>(MOVIE_GENRES.map(([id]) => id));
const genresSchema = z
  .array(z.coerce.number().int())
  .max(MOVIE_GENRES.length)
  .refine((ids) => ids.every((id) => genreIds.has(id)), "Unknown genre.");
const moviesSchema = z
  .array(z.coerce.number().int().positive().max(2_147_483_647))
  .max(FAVORITE_MOVIE_LIMIT, "Choose up to five favorite movies.")
  .refine((ids) => new Set(ids).size === ids.length, "Choose each movie once.");
const nextSchema = z.string().max(2048).catch("/");

const signedOut = { error: "Your session expired. Sign in again to continue." };
const unavailable = {
  error: "We couldn't save that right now. Please try again.",
};

function field(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

/** The genre and favorite forms are reused in Settings, which stays on the page. */
function fromSettings(data: FormData) {
  return field(data, "mode") === "settings";
}
function savedInSettings(): OnboardingState {
  revalidatePath("/settings");
  revalidatePath("/u/[username]", "layout");
  return { saved: true };
}

/** Debounced availability check for the username field. */
export async function checkUsername(
  candidate: unknown,
): Promise<UsernameStatus | "error"> {
  const parsed = z.string().max(100).safeParse(candidate);
  if (!parsed.success) return "invalid";
  const local = localUsernameStatus(parsed.data);
  if (local) return local;
  const user = await getUser();
  if (!user) return "error";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("username_status", {
    candidate: parsed.data,
  });
  if (error || !data || !(data in USERNAME_MESSAGES)) return "error";
  return data as UsernameStatus;
}

export async function claimUsername(
  _state: OnboardingState,
  data: FormData,
): Promise<OnboardingState> {
  const next = nextSchema.parse(field(data, "next"));
  const parsed = usernameSchema.safeParse(field(data, "username"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const user = await getUser();
  if (!user) return signedOut;
  const supabase = await createClient();
  // Only an unset username can be claimed; the database also enforces permanence.
  const { data: rows, error } = await supabase
    .from("users")
    .update({ username: parsed.data })
    .eq("id", user.id)
    .is("username", null)
    .select("username");
  if (error?.code === "23505")
    // Another account claimed it between the availability check and saving.
    return { error: USERNAME_MESSAGES.taken };
  if (error?.code === "23514") return { error: USERNAME_MESSAGES.invalid };
  if (error) return unavailable;
  if (!rows?.length && !(await readUsername(supabase, user.id)))
    return unavailable;
  revalidatePath("/", "layout");
  redirect(onboardingStepPath("genres", next));
}

async function requireOnboardedUser() {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  if (!(await readUsername(supabase, user.id)))
    redirect(onboardingStepPath("username", "/"));
  return { user, supabase };
}

export async function saveGenres(
  _state: OnboardingState,
  data: FormData,
): Promise<OnboardingState> {
  const next = nextSchema.parse(field(data, "next"));
  const parsed = genresSchema.safeParse(data.getAll("genre"));
  if (!parsed.success) return { error: "Choose genres from the list." };
  const session = await requireOnboardedUser();
  if (!session) return signedOut;
  if (
    !(await savePreferences(session.supabase, session.user.id, {
      favorite_genre_ids: parsed.data,
    }))
  )
    return unavailable;
  if (fromSettings(data)) return savedInSettings();
  redirect(onboardingStepPath("movies", next));
}

export async function saveFavoriteMovies(
  _state: OnboardingState,
  data: FormData,
): Promise<OnboardingState> {
  const next = nextSchema.parse(field(data, "next"));
  const parsed = moviesSchema.safeParse(data.getAll("movie"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const session = await requireOnboardedUser();
  if (!session) return signedOut;
  try {
    if (parsed.data.length) {
      await limitMovieRequest("selection", await headers(), session.user.id);
      // Favorites reference movies, so cache authoritative TMDB metadata first.
      // Only IDs come from the client; titles and posters come from TMDB.
      for (const id of parsed.data) await cacheMovie(await getMovieDetails(id));
    }
  } catch (error) {
    if (error instanceof MovieError)
      return {
        error:
          error.status === 404
            ? "One of those movies is no longer available. Remove it and try again."
            : error.message,
      };
    return unavailable;
  }
  const { error } = await session.supabase.rpc("set_favorite_movies", {
    movie_ids: parsed.data,
  });
  if (error) return unavailable;
  if (fromSettings(data)) return savedInSettings();
  redirect(onboardingStepPath("finish", next));
}
