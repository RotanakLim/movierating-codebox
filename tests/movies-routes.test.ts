import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  details: vi.fn(),
  save: vi.fn(),
  limit: vi.fn(),
  search: vi.fn(),
}));
vi.mock("@/lib/auth/user", () => ({ getUser: mocks.user }));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({ siteUrl: "https://codebox.test" }),
}));
vi.mock("@/lib/movies/tmdb", () => ({
  getMovieDetails: mocks.details,
  requireTmdbToken: () => "",
  searchMovies: mocks.search,
}));
vi.mock("@/lib/supabase/movie-cache", () => ({ cacheMovie: mocks.save }));
vi.mock("@/lib/movies/limits", () => ({ limitMovieRequest: mocks.limit }));
import { POST } from "@/app/api/movies/cache/route";
import { GET } from "@/app/api/movies/search/route";
import { MovieError } from "@/lib/movies/errors";
const movie = {
  id: 693134,
  title: "Dune: Part Two",
  posterPath: "/dune.jpg",
  year: 2024,
};
function request(
  body: unknown = { tmdbId: 693134 },
  origin = "https://codebox.test",
) {
  return new NextRequest("https://codebox.test/api/movies/cache", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.user.mockResolvedValue({
    id: "verified-user",
    email_confirmed_at: "2026-09-29",
  });
  mocks.details.mockResolvedValue(movie);
  mocks.save.mockResolvedValue({});
  mocks.limit.mockResolvedValue(undefined);
});
describe("select and cache route", () => {
  it("requires a signed-in user", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("requires confirmed email", async () => {
    mocks.user.mockResolvedValue({ id: "user" });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.details).not.toHaveBeenCalled();
  });
  it("rejects cross-origin submissions", async () => {
    expect((await POST(request(undefined, "https://evil.test"))).status).toBe(
      403,
    );
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("rejects injected cache fields", async () => {
    expect(
      (await POST(request({ tmdbId: 693134, title: "poisoned" }))).status,
    ).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("bounds the request body", async () => {
    expect((await POST(request({ tmdbId: "1".repeat(300) }))).status).toBe(413);
  });
  it("rejects invalid movie identifiers", async () => {
    expect((await POST(request({ tmdbId: "../../x" }))).status).toBe(400);
  });
  it("fetches authoritative movie details and saves only after authorization", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.details).toHaveBeenCalledWith(693134);
    expect(mocks.save).toHaveBeenCalledWith(movie);
    expect(mocks.limit).toHaveBeenCalledWith(
      "selection",
      expect.anything(),
      "verified-user",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ movie });
  });
  it("never writes rejected or deleted provider records", async () => {
    mocks.details.mockRejectedValue(new MovieError(404, "Unavailable"));
    expect((await POST(request())).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not report success on DB failure or expose database errors", async () => {
    mocks.save.mockRejectedValue(new Error("service-key-secret"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("service-key-secret");
  });
  it("propagates bounded rate limits", async () => {
    mocks.limit.mockRejectedValue(
      new MovieError(429, "Wait", "RATE_LIMITED", 60),
    );
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.details).not.toHaveBeenCalled();
  });
});
describe("search route", () => {
  it("is public and sends validated filters to TMDB", async () => {
    mocks.search.mockResolvedValue({
      movies: [movie],
      page: 1,
      hasMore: false,
      filteredPage: false,
    });
    const response = await GET(
      new NextRequest(
        "https://codebox.test/api/movies/search?q=dune&year=2024",
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.user).not.toHaveBeenCalled();
    // Search stays limited per client IP even though results are cached.
    expect(mocks.limit).toHaveBeenCalledWith("search", expect.any(Headers));
    expect(mocks.search).toHaveBeenCalledWith({
      query: "dune",
      year: 2024,
      genre: null,
      page: 1,
    });
  });
  it("returns 429 without searching when the per-IP limit is spent", async () => {
    mocks.limit.mockRejectedValue(
      new MovieError(429, "Wait", "RATE_LIMITED", 30),
    );
    const response = await GET(
      new NextRequest("https://codebox.test/api/movies/search?q=dune"),
    );
    expect(response.status).toBe(429);
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it("rejects invalid pagination before provider calls", async () => {
    const response = await GET(
      new NextRequest("https://codebox.test/api/movies/search?page=501"),
    );
    expect(response.status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
