import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  details: vi.fn(),
  cached: vi.fn(),
  limit: vi.fn(),
  entries: vi.fn(),
  summary: vi.fn(),
  reviews: vi.fn(),
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
vi.mock("@/lib/movies/rating-summary", () => ({
  loadRatingSummary: mocks.summary,
}));
vi.mock("@/lib/reviews/load", () => ({ loadReviews: mocks.reviews }));
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
  availableFrom: "2024-02-28",
  cast: [{ name: "Zendaya", character: "Chani" }],
  trailer: { name: "Trailer", url: "https://www.youtube.com/watch?v=abcdef" },
};
const props = (tmdbId: string) => ({
  params: Promise.resolve({ tmdbId }),
  searchParams: Promise.resolve({}),
});
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.details.mockResolvedValue(movie);
  mocks.cached.mockResolvedValue(null);
  mocks.entries.mockResolvedValue({
    viewer: { status: "guest" },
    entries: [],
    watchlisted: false,
  });
  mocks.summary.mockResolvedValue({ average: 8.4, raters: 12 });
  mocks.reviews.mockResolvedValue({ reviews: [], nextCursor: null });
});

describe("movie page", () => {
  it("renders from cached details without a rate-limit write", async () => {
    await MoviePage(props("693134"));
    expect(mocks.details).toHaveBeenCalledWith(693134);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("loads the viewer's own entries for the composer", async () => {
    const entries = [{ id: "entry-1" }];
    mocks.entries.mockResolvedValue({
      viewer: { status: "guest" },
      entries,
      watchlisted: false,
    });
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
  it("shows CodeBox and TMDB scores separately, with the trailer as a link", async () => {
    const tree = await MoviePage(props("693134"));
    const text: string[] = [];
    const links: Record<string, unknown>[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === "string" || typeof node === "number")
        return void text.push(String(node));
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const { type, props } = node as {
        type: unknown;
        props: Record<string, unknown>;
      };
      if (type === "a") links.push(props);
      if (type === "iframe" || type === "video") throw new Error("embedded");
      walk(props.children);
    };
    walk(tree);
    const page = text.join(" ");
    expect(page).toContain("CodeBox members");
    expect(page).toContain("8.4");
    expect(page).toContain("12");
    expect(page).toContain("TMDB users");
    expect(page).toContain("8.2");
    expect(page).toContain("Zendaya");
    expect(links).toContainEqual(
      expect.objectContaining({
        href: "https://www.youtube.com/watch?v=abcdef",
        target: "_blank",
      }),
    );
  });
  it("says 'Not rated yet' without a CodeBox average", async () => {
    mocks.summary.mockResolvedValue({ average: null, raters: 0 });
    const text: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === "string") return void text.push(node);
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object" && "props" in node)
        walk((node as { props: { children?: unknown } }).props.children);
    };
    walk(await MoviePage(props("693134")));
    expect(text).toContain("Not rated yet");
  });
  it("never puts review text in page metadata", async () => {
    mocks.reviews.mockResolvedValue({
      reviews: [{ note: "The twist is X", spoiler: true }],
      nextCursor: null,
    });
    const metadata = await generateMetadata(props("693134"));
    expect(JSON.stringify(metadata)).not.toContain("twist");
    expect(mocks.reviews).not.toHaveBeenCalled();
  });
});
