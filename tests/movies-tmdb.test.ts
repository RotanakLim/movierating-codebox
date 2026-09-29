import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
import { getMovieDetails, searchMovies } from "@/lib/movies/tmdb";
import { movieId, searchFilters, posterPath } from "@/lib/movies/validation";
const fetchMock = vi.fn();
const rawMovie = {
  id: 693134,
  title: "Dune: Part Two",
  adult: false,
  poster_path: "/dune.jpg",
  release_date: "2024-03-01",
  genre_ids: [878],
};
beforeEach(() => {
  vi.stubEnv("TMDB_API_READ_ACCESS_TOKEN", "test-token-not-a-real-credential");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("TMDB server integration", () => {
  it("uses header authentication and strips raw metadata from search results", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        results: [{ ...rawMovie, unexpected: "private" }],
        total_pages: 1,
      }),
    );
    const result = await searchMovies({
      query: "Dune & friends",
      genre: null,
      year: 2024,
      page: 1,
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.origin).toBe("https://api.themoviedb.org");
    expect(url.pathname).toBe("/3/search/movie");
    expect(url.searchParams.get("query")).toBe("Dune & friends");
    expect(url.searchParams.get("primary_release_year")).toBe("2024");
    expect(url.searchParams.get("include_adult")).toBe("false");
    expect(url.toString()).not.toContain("test-token");
    expect(options.headers.Authorization).toBe(
      "Bearer test-token-not-a-real-credential",
    );
    expect(result.movies).toEqual([
      {
        id: 693134,
        title: "Dune: Part Two",
        posterPath: "/dune.jpg",
        year: 2024,
        genreIds: [878],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("test-token");
  });
  it("filters adult, malformed, and mismatched genre results without false totals", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        results: [
          rawMovie,
          { ...rawMovie, id: 2, adult: true },
          { ...rawMovie, id: 3, genre_ids: [35] },
          { ...rawMovie, id: "bad" },
        ],
        total_pages: 3,
      }),
    );
    const result = await searchMovies({
      query: "Dune",
      genre: 878,
      year: null,
      page: 1,
    });
    expect(result.movies).toHaveLength(1);
    expect(result.filteredPage).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result).not.toHaveProperty("total_results");
  });
  it("browses by genre/year through discover", async () => {
    fetchMock.mockResolvedValue(Response.json({ results: [], total_pages: 0 }));
    await searchMovies({ query: "", genre: 35, year: 1999, page: 1 });
    const url = fetchMock.mock.calls[0][0];
    expect(url.pathname).toBe("/3/discover/movie");
    expect(url.searchParams.get("with_genres")).toBe("35");
  });
  it("keeps safe fallbacks for unknown year/poster", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        ...rawMovie,
        release_date: "",
        poster_path: "https://evil.test/file",
        overview: "Story",
        runtime: 0,
      }),
    );
    const movie = await getMovieDetails(693134);
    expect(movie.posterPath).toBeNull();
    expect(movie.year).toBeNull();
    expect(movie.runtime).toBeNull();
  });
  it("rejects adult details so they cannot be cached", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...rawMovie, adult: true }));
    await expect(getMovieDetails(693134)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects mismatched provider IDs", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...rawMovie, id: 10 }));
    await expect(getMovieDetails(693134)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("handles upstream rate limits without echoing provider bodies", async () => {
    fetchMock.mockResolvedValue(
      new Response("secret diagnostic", {
        status: 429,
        headers: { "Retry-After": "45" },
      }),
    );
    await expect(getMovieDetails(693134)).rejects.toMatchObject({
      status: 429,
      retryAfter: 45,
    });
  });
  it("handles timeout", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("sensitive upstream URL", "TimeoutError"),
    );
    await expect(getMovieDetails(693134)).rejects.toMatchObject({
      status: 504,
    });
  });
  it("fails clearly before calling upstream when no token exists", async () => {
    vi.stubEnv("TMDB_API_READ_ACCESS_TOKEN", "");
    await expect(getMovieDetails(693134)).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects malformed provider payloads", async () => {
    fetchMock.mockResolvedValue(Response.json({ message: "not results" }));
    await expect(
      searchMovies({ query: "dune", genre: null, year: null, page: 1 }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
describe("input boundaries", () => {
  it.each([0, -1, 1.5, "../movie/1", "1?api_key=bad", 2147483648])(
    "rejects movie id %s",
    (id) => expect(() => movieId(id)).toThrow(),
  );
  it.each(["page=501", "page=-1", "genre=9999", "year=NaN", "year=2300"])(
    "rejects bad filters %s",
    (value) =>
      expect(() => searchFilters(new URLSearchParams(value))).toThrow(),
  );
  it("rejects traversal and arbitrary poster hosts", () => {
    expect(posterPath("/../../a.jpg")).toBeNull();
    expect(posterPath("//evil.test/a.jpg")).toBeNull();
  });
});
