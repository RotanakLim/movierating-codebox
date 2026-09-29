import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Star } from "lucide-react";
import { getMovieDetails, requireTmdbToken } from "@/lib/movies/tmdb";
import { movieId } from "@/lib/movies/validation";
import { MovieError } from "@/lib/movies/errors";
import { limitMovieRequest } from "@/lib/movies/limits";
import { readCachedMovie } from "@/lib/supabase/movie-cache";
import { MoviePoster } from "@/components/movies/poster";
import { SelectMovie } from "@/components/movies/select-movie";
import { safeNext } from "@/lib/auth/redirect";
import type { MovieDetails } from "@/lib/movies/types";
export const metadata: Metadata = { title: "Movie details" };
export default async function MoviePage({
  params,
  searchParams,
}: {
  params: Promise<{ tmdbId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { tmdbId } = await params;
  let id: number;
  try {
    id = movieId(tmdbId);
  } catch {
    notFound();
  }
  const { from } = await searchParams;
  const source = safeNext(from, "/discover");
  const back = source.split("?")[0] === "/discover" ? source : "/discover";
  let movie: MovieDetails | null = null;
  let failure = "Movie details are temporarily unavailable. Please try again.";
  try {
    requireTmdbToken();
    await limitMovieRequest("search", await headers());
    movie = await getMovieDetails(id);
  } catch (error) {
    // A rejected/adult/deleted TMDB record must not be resurrected from the DB.
    if (error instanceof MovieError && error.status === 404) notFound();
    if (error instanceof MovieError) failure = error.message;
    movie = await readCachedMovie(id);
  }
  if (!movie)
    return (
      <section className="mx-auto max-w-xl py-16">
        <Link href={back} className="text-sm text-accent">
          ← Back to discovery
        </Link>
        <h1 className="mt-8 font-display text-4xl">A brief intermission.</h1>
        <p role="alert" className="mt-4 text-muted">
          {failure}
        </p>
        <Link
          href={`/movies/${id}?from=${encodeURIComponent(back)}`}
          className="button-secondary mt-6"
        >
          Try again
        </Link>
      </section>
    );
  const selectedMovie = movie;
  return (
    <section className="py-10 sm:py-14">
      <Link
        href={back}
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back to results
      </Link>
      <div className="mt-9 grid gap-9 sm:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr] lg:gap-14">
        <div className="mx-auto w-full max-w-[280px] sm:mx-0">
          <MoviePoster path={movie.posterPath} title={movie.title} priority />
          <SelectMovie movieId={movie.id} title={movie.title} />
        </div>
        <div className="max-w-2xl">
          <p className="eyebrow mb-4">THE MOVIE COLLECTION</p>
          <h1 className="font-display text-4xl leading-tight sm:text-5xl">
            {movie.title}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-muted">
            <span>{movie.year ?? "Release year unknown"}</span>
            {movie.runtime && (
              <span className="inline-flex items-center gap-1.5">
                <Clock size={14} aria-hidden="true" />
                {movie.runtime} min
              </span>
            )}
            {movie.voteCount > 0 && movie.voteAverage !== null && (
              <span className="inline-flex items-center gap-1.5">
                <Star size={14} aria-hidden="true" />
                {movie.voteAverage.toFixed(1)}/10 · TMDB (
                {movie.voteCount.toLocaleString("en-US")} votes)
              </span>
            )}
          </div>
          {movie.genres.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {movie.genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full border border-line px-3 py-1.5 text-xs"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}
          {movie.stale && (
            <p
              role="status"
              className="mt-6 rounded-xl border border-line p-4 text-sm text-muted"
            >
              Some movie details are temporarily unavailable. Previously saved
              information is shown.
            </p>
          )}
          <h2 className="mt-9 text-sm font-semibold">The story</h2>
          <p className="mt-3 whitespace-pre-line leading-relaxed text-muted">
            {movie.overview ?? "A synopsis isn't available for this movie yet."}
          </p>
          <p className="mt-9 border-t border-line pt-5 text-sm text-muted">
            Personal ratings and reviews are coming next.
          </p>
          <a
            href={`https://www.themoviedb.org/movie/${selectedMovie.id}`}
            className="mt-5 inline-block text-sm text-accent underline"
            target="_blank"
            rel="noreferrer"
          >
            More on TMDB
          </a>
        </div>
      </div>
    </section>
  );
}
