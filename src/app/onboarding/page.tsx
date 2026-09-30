import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Globe } from "lucide-react";
import { requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { readUsername } from "@/lib/onboarding/profile";
import {
  ONBOARDING_STEPS,
  onboardingNext,
  onboardingStepPath,
  type OnboardingStep,
} from "@/lib/onboarding/steps";
import { UsernameForm } from "@/components/onboarding/username-form";
import { NotifyProfileChanged } from "@/components/profile-link";
import { GenreForm } from "@/components/onboarding/genre-form";
import {
  FavoriteMoviesForm,
  type FavoriteMovie,
} from "@/components/onboarding/favorite-movies-form";

export const metadata: Metadata = {
  title: "Set up your profile",
  robots: { index: false, follow: false },
};

const STEP_LABELS: Record<OnboardingStep, string> = {
  username: "Username",
  genres: "Favorite genres",
  movies: "Favorite movies",
  finish: "Finish",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = onboardingNext(params.next);
  const user = await requireUser(onboardingStepPath("username", next));
  const supabase = await createClient();
  const username = await readUsername(supabase, user.id);
  const requested = ONBOARDING_STEPS.find((step) => step === params.step);
  // The username is required before anything else; later steps are skippable.
  if (!username && requested && requested !== "username")
    redirect(onboardingStepPath("username", next));
  const step: OnboardingStep = !username
    ? "username"
    : requested && requested !== "username"
      ? requested
      : "genres";

  let genres: number[] = [];
  let favorites: FavoriteMovie[] = [];
  if (step === "genres") {
    const { data } = await supabase
      .from("user_preferences")
      .select("favorite_genre_ids")
      .eq("user_id", user.id)
      .maybeSingle();
    genres = data?.favorite_genre_ids ?? [];
  }
  if (step === "movies") {
    const { data } = await supabase
      .from("user_favorite_movies")
      .select("movie_id, added_at, movies(title, poster, year)")
      .eq("user_id", user.id)
      .order("added_at");
    favorites = (data ?? []).flatMap((row) =>
      row.movies
        ? [
            {
              id: row.movie_id,
              title: row.movies.title,
              posterPath: row.movies.poster,
              year: row.movies.year,
            },
          ]
        : [],
    );
  }
  const index = ONBOARDING_STEPS.indexOf(step);

  return (
    <section className="mx-auto max-w-2xl py-12 sm:py-16">
      {username && <NotifyProfileChanged />}
      <p className="eyebrow mb-4">WELCOME TO CODEBOX</p>
      <ol className="mb-10 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
        {ONBOARDING_STEPS.map((item, position) => (
          <li
            key={item}
            aria-current={item === step ? "step" : undefined}
            className={item === step ? "font-semibold text-ink" : undefined}
          >
            {position + 1}. {STEP_LABELS[item]}
            {position < index && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ol>

      {step === "username" && (
        <>
          <h1 className="font-display text-4xl">Choose your username.</h1>
          <p className="mt-4 leading-relaxed text-muted">
            It&apos;s how people find you and appears on your public reviews.
          </p>
          <UsernameForm next={next} />
        </>
      )}

      {step === "genres" && (
        <>
          <h1 className="font-display text-4xl">What do you love to watch?</h1>
          <p className="mt-4 leading-relaxed text-muted">
            Pick any genres you enjoy. This is optional, and you can change it
            later.
          </p>
          <GenreForm
            next={next}
            selected={genres}
            skipHref={onboardingStepPath("movies", next)}
          />
        </>
      )}

      {step === "movies" && (
        <>
          <h1 className="font-display text-4xl">A few favorites?</h1>
          <p className="mt-4 leading-relaxed text-muted">
            Add up to five movies you love. Favorites don&apos;t create ratings
            or diary entries. This is optional, and you can change it later.
          </p>
          <FavoriteMoviesForm
            next={next}
            initial={favorites}
            skipHref={onboardingStepPath("finish", next)}
          />
        </>
      )}

      {step === "finish" && (
        <>
          <h1 className="font-display text-4xl">
            You&apos;re all set, @{username}.
          </h1>
          <div className="mt-8 rounded-2xl border border-line bg-surface p-6">
            <div className="flex items-start gap-3">
              <Globe
                className="mt-0.5 shrink-0 text-accent"
                size={22}
                aria-hidden="true"
              />
              <div>
                <h2 className="font-semibold">Your profile is public</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Anyone can see your display name, bio, favorites, ratings,
                  diary, watchlist, and who you follow. Your username and avatar
                  are always public. You can make your profile visible only to
                  followers, friends, or just you at any time in Settings.
                </p>
              </div>
            </div>
          </div>
          <Link href={next} className="button-primary mt-8">
            Finish
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </>
      )}
    </section>
  );
}
