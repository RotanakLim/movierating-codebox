import type { Metadata } from "next";
import { Suspense } from "react";
import { MovieSearchPage } from "@/components/movies/search";
export const metadata: Metadata = {
  title: "Discover movies",
  description:
    "Search movies, find a favorite, and explore by genre and release year.",
};
export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        // Hold a screen's height so the footer doesn't jump when search mounts (CLS).
        <div className="min-h-screen py-16">
          <p role="status">Loading movie discovery…</p>
        </div>
      }
    >
      <MovieSearchPage />
    </Suspense>
  );
}
