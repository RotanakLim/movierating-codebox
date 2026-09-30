import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  from: vi.fn(),
  create: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.create }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({ url: "https://supabase.test" }),
}));
import { cacheMovie, consumeMovieLimit } from "@/lib/supabase/movie-cache";
import type { MovieDetails } from "@/lib/movies/types";
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-server-credential");
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.from.mockReturnValue({ upsert: mocks.upsert });
  mocks.create.mockReturnValue({ from: mocks.from, rpc: mocks.rpc });
});
afterEach(() => vi.unstubAllEnvs());
it("upserts an exact minimal cache row and never persists the TMDB payload", async () => {
  const movie: MovieDetails = {
    id: 693134,
    title: "Dune",
    posterPath: "/dune.jpg",
    year: 2024,
    overview: "Do not store",
    runtime: 160,
    genres: ["Science fiction"],
    genreIds: [878],
    releaseDate: "2024-03-01",
    availableFrom: "2024-02-28",
    cast: [{ name: "Do Not Store", character: "Nobody" }],
    trailer: { name: "Trailer", url: "https://www.youtube.com/watch?v=abcdef" },
    voteAverage: 8,
    voteCount: 30,
  };
  await cacheMovie(movie);
  expect(mocks.from).toHaveBeenCalledWith("movies");
  expect(mocks.upsert).toHaveBeenCalledWith(
    {
      tmdb_id: 693134,
      title: "Dune",
      poster: "/dune.jpg",
      year: 2024,
      cached_at: expect.any(String),
    },
    { onConflict: "tmdb_id" },
  );
  expect(mocks.create.mock.calls[0][2].auth).toEqual({
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
});
it("refuses writes without a server credential", async () => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  await expect(cacheMovie({} as MovieDetails)).rejects.toMatchObject({
    status: 503,
  });
});
it("does not swallow a cache-write error", async () => {
  mocks.upsert.mockResolvedValue({ error: { message: "private detail" } });
  await expect(cacheMovie({} as MovieDetails)).rejects.toMatchObject({
    status: 503,
    code: "CACHE_UNAVAILABLE",
  });
});
it("enforces a persistent limit denial", async () => {
  mocks.rpc.mockResolvedValue({
    data: { allowed: false, retry_after: 37 },
    error: null,
  });
  await expect(
    consumeMovieLimit("search", "a".repeat(64)),
  ).rejects.toMatchObject({ status: 429, retryAfter: 37 });
});
