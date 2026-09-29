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
        <p className="py-16" role="status">
          Loading movie discovery…
        </p>
      }
    >
      <MovieSearchPage />
    </Suspense>
  );
}
