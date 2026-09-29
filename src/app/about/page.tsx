import { TmdbCredit } from "@/components/movies/tmdb-credit";
import Link from "next/link";
export default function AboutPage() {
  return (
    <section className="mx-auto max-w-2xl py-16">
      <p className="eyebrow mb-4">ABOUT CODEBOX MOVIES</p>
      <h1 className="font-display text-4xl">
        For the movies that stay with you.
      </h1>
      <p className="mt-5 leading-relaxed text-muted">
        CodeBox Movies is a portfolio project for discovering movies and
        building a personal movie diary. Movie search and account access are
        available; ratings and social features are in development.
      </p>
      <div className="mt-10 rounded-2xl border border-line bg-surface p-6">
        <h2 className="mb-5 font-semibold">Movie data and images</h2>
        <TmdbCredit />
        <p className="mt-5 text-sm leading-relaxed text-muted">
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </p>
      </div>
      <Link href="/discover" className="button-primary mt-8">
        Discover movies
      </Link>
    </section>
  );
}
