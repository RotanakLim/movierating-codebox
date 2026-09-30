import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, Clock, Play } from "lucide-react";
import { getMovieDetails } from "@/lib/movies/tmdb";
import { movieId } from "@/lib/movies/validation";
import { MovieError } from "@/lib/movies/errors";
import { readCachedMovie } from "@/lib/supabase/movie-cache";
import { MoviePoster } from "@/components/movies/poster";
import { safeNext } from "@/lib/auth/redirect";
import type { MovieDetails } from "@/lib/movies/types";
import { EntryComposer } from "@/components/entries/entry-composer";
import { loadViewerEntries } from "@/lib/entries/load";
import { loadRatingSummary } from "@/lib/movies/rating-summary";
import { loadReviews } from "@/lib/reviews/load";
import { formatScore } from "@/lib/entries/score";
import { todayIn } from "@/lib/entries/dates";
import { WatchlistToggle } from "@/components/movies/watchlist-toggle";
import { ReviewList } from "@/components/reviews/review-list";
import { AddToLists } from "@/components/movies/add-to-lists";

type PageProps = {
  params: Promise<{ tmdbId: string }>;
  searchParams: Promise<{ from?: string; compose?: string; edit?: string }>;
};
type MovieLookup =
  | { status: "found"; movie: MovieDetails }
  | { status: "missing" }
  | { status: "unavailable"; id: number; failure: string };

// Shared by generateMetadata and the page within one request, so a cold cache
// still makes a single TMDB call (details are cached for 24 hours by
// unstable_cache; a page view needs no rate-limit write).
const loadMovie = cache(async (tmdbId: string): Promise<MovieLookup> => {
  let id: number;
  try {
    id = movieId(tmdbId);
  } catch {
    return { status: "missing" };
  }
  let failure = "Movie details are temporarily unavailable. Please try again.";
  try {
    return { status: "found", movie: await getMovieDetails(id) };
  } catch (error) {
    // A rejected/adult/deleted TMDB record must not be resurrected from the DB.
    if (error instanceof MovieError && error.status === 404)
      return { status: "missing" };
    if (error instanceof MovieError) failure = error.message;
  }
  const cached = await readCachedMovie(id);
  return cached
    ? { status: "found", movie: cached }
    : { status: "unavailable", id, failure };
});

export async function generateMetadata({
  params,
}: Pick<PageProps, "params">): Promise<Metadata> {
  const result = await loadMovie((await params).tmdbId);
  if (result.status !== "found") return { title: "Movie details" };
  const { title, year } = result.movie;
  return { title: year ? `${title} (${year})` : title };
}

export default async function MoviePage({ params, searchParams }: PageProps) {
  const { tmdbId } = await params;
  const result = await loadMovie(tmdbId);
  if (result.status === "missing") notFound();
  const { from, compose, edit } = await searchParams;
  const source = safeNext(from, "/discover");
  const back = source.split("?")[0] === "/discover" ? source : "/discover";
  if (result.status === "unavailable") {
    const { id, failure } = result;
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
  }
  const { movie } = result;
  const [{ viewer, entries, watchlisted, lists }, summary, reviews] =
    await Promise.all([
      loadViewerEntries(movie.id),
      loadRatingSummary(movie.id),
      loadReviews(movie.id, { cursor: null, writtenOnly: false }).catch(
        () => null,
      ),
    ]);
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
        <div className="mx-auto w-full max-w-[280px] space-y-4 sm:mx-0">
          <MoviePoster
            path={movie.posterPath}
            title={movie.title}
            size="w500"
            priority
          />
          <WatchlistToggle
            movieId={movie.id}
            initial={watchlisted}
            viewer={viewer.status}
          />
          {viewer.status === "ready" && (
            <AddToLists movieId={movie.id} lists={lists} />
          )}
        </div>
        <div className="min-w-0 max-w-2xl">
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
          </div>

          {/* CodeBox and TMDB scores are separate and never blended. */}
          <dl className="mt-6 grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="rounded-xl border border-line p-4">
              <dt className="text-xs text-muted">CodeBox members</dt>
              <dd className="mt-1">
                {summary && summary.average !== null && summary.raters > 0 ? (
                  <>
                    <span className="font-display text-2xl tabular-nums">
                      {formatScore(summary.average)}
                    </span>
                    <span className="text-sm text-muted">/10</span>
                    <span className="block text-xs text-muted">
                      {summary.raters.toLocaleString("en-US")}{" "}
                      {summary.raters === 1 ? "rating" : "ratings"}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-muted">
                    {summary ? "Not rated yet" : "Unavailable right now"}
                  </span>
                )}
              </dd>
            </div>
            <div className="rounded-xl border border-line p-4">
              <dt className="text-xs text-muted">TMDB users</dt>
              <dd className="mt-1">
                {movie.voteCount > 0 && movie.voteAverage !== null ? (
                  <>
                    <span className="font-display text-2xl tabular-nums">
                      {movie.voteAverage.toFixed(1)}
                    </span>
                    <span className="text-sm text-muted">/10</span>
                    <span className="block text-xs text-muted">
                      {movie.voteCount.toLocaleString("en-US")}{" "}
                      {movie.voteCount === 1 ? "vote" : "votes"}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-muted">No TMDB score</span>
                )}
              </dd>
            </div>
          </dl>

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
          {movie.trailer && (
            // A plain link: the trailer opens only when clicked, never autoplays.
            <a
              href={movie.trailer.url}
              target="_blank"
              rel="noopener noreferrer"
              className="button-secondary mt-6"
            >
              <Play size={16} aria-hidden="true" />
              Watch trailer
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}

          <h2 className="mt-9 text-sm font-semibold">Cast</h2>
          {movie.cast.length > 0 ? (
            <ul className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {movie.cast.map((person) => (
                <li key={`${person.name}-${person.character}`}>
                  <span className="font-medium">{person.name}</span>
                  {person.character && (
                    <span className="text-muted"> as {person.character}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Cast information isn&apos;t available yet.
            </p>
          )}

          <EntryComposer
            movieId={movie.id}
            movieTitle={movie.title}
            viewer={viewer}
            entries={entries}
            compose={compose === "rate" || compose === "log" ? compose : null}
            opensOn={movie.availableFrom}
            serverToday={todayIn("UTC")}
            editId={edit ?? null}
          />
          <a
            href={`https://www.themoviedb.org/movie/${movie.id}`}
            className="mt-5 inline-block text-sm text-accent underline"
            target="_blank"
            rel="noreferrer"
          >
            More on TMDB
          </a>
        </div>
      </div>
      {reviews ? (
        <ReviewList
          movieId={movie.id}
          initial={reviews}
          viewerId={viewer.status === "ready" ? viewer.userId : null}
        />
      ) : (
        <p className="mt-12 text-sm text-muted">
          Reviews are unavailable right now.
        </p>
      )}
    </section>
  );
}
