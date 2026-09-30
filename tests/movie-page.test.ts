import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  details: vi.fn(),
  cached: vi.fn(),
  limit: vi.fn(),
  entries: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/movies/tmdb", () => ({ getMovieDetails: mocks.details }));
vi.mock("@/lib/supabase/movie-cache", () => ({
  readCachedMovie: mocks.cached,
}));
vi.mock("@/lib/movies/limits", () => ({ limitMovieRequest: mocks.limit }));
vi.mock("@/lib/entries/load", () => ({ loadViewerEntries: mocks.entries }));
import MoviePage, { generateMetadata } from "@/app/movies/[tmdbId]/page";
import { MovieError } from "@/lib/movies/errors";

const movie = {
  id: 693134,
  title: "Dune: Part Two",
  posterPath: "/dune.jpg",
  year: 2024,
  genreIds: [],
  genres: [],
  runtime: 167,
  overview: null,
  releaseDate: "2024-03-01",
  voteAverage: 8.2,
  voteCount: 100,
};
const props = (tmdbId: string) => ({
  params: Promise.resolve({ tmdbId }),
  searchParams: Promise.resolve({}),
});
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.details.mockResolvedValue(movie);
  mocks.cached.mockResolvedValue(null);
  mocks.entries.mockResolvedValue({ viewer: { status: "guest" }, entries: [] });
});

describe("movie page", () => {
  it("renders from cached details without a rate-limit write", async () => {
    await MoviePage(props("693134"));
    expect(mocks.details).toHaveBeenCalledWith(693134);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("loads the viewer's own entries for the composer", async () => {
    const entries = [{ id: "entry-1" }];
    mocks.entries.mockResolvedValue({ viewer: { status: "guest" }, entries });
    const found: Record<string, unknown>[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const { type, props } = node as {
        type: { name?: string };
        props: Record<string, unknown>;
      };
      if (type?.name === "EntryComposer") found.push(props);
      walk(props.children);
    };
    walk(await MoviePage(props("693134")));
    expect(mocks.entries).toHaveBeenCalledWith(693134);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ movieId: 693134, entries });
  });
  it("titles the page '<Title> (<Year>)'", async () => {
    expect(await generateMetadata(props("693134"))).toEqual({
      title: "Dune: Part Two (2024)",
    });
    mocks.details.mockResolvedValue({ ...movie, year: null });
    expect(await generateMetadata(props("693134"))).toEqual({
      title: "Dune: Part Two",
    });
  });
  it("uses a generic title and 404s for rejected movies", async () => {
    mocks.details.mockRejectedValue(
      new MovieError(404, "Unavailable", "MOVIE_NOT_FOUND"),
    );
    expect(await generateMetadata(props("693134"))).toEqual({
      title: "Movie details",
    });
    await expect(MoviePage(props("693134"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.cached).not.toHaveBeenCalled();
    await expect(MoviePage(props("not-a-number"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
  it("falls back to the minimal cached row when TMDB is unavailable", async () => {
    mocks.details.mockRejectedValue(new MovieError(503, "Busy"));
    mocks.cached.mockResolvedValue({ ...movie, stale: true });
    expect(await generateMetadata(props("693134"))).toEqual({
      title: "Dune: Part Two (2024)",
    });
  });
});
