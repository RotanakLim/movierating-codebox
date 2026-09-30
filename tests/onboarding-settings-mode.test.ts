import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  username: vi.fn(),
  limit: vi.fn(),
  details: vi.fn(),
  cache: vi.fn(),
  preferences: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/user", () => ({ getUser: mocks.user }));
vi.mock("@/lib/onboarding/profile", () => ({ readUsername: mocks.username }));
vi.mock("@/lib/movies/limits", () => ({ limitMovieRequest: mocks.limit }));
vi.mock("@/lib/movies/tmdb", () => ({ getMovieDetails: mocks.details }));
vi.mock("@/lib/supabase/movie-cache", () => ({ cacheMovie: mocks.cache }));
vi.mock("@/lib/settings/preferences", () => ({
  savePreferences: mocks.preferences,
}));
const client = { rpc: mocks.rpc };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
import { saveFavoriteMovies, saveGenres } from "@/app/onboarding/actions";

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values))
    for (const item of [value].flat()) data.append(key, item);
  return data;
}
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.user.mockResolvedValue({ id: "user-1" });
  mocks.username.mockResolvedValue("film_fan");
  mocks.preferences.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.details.mockImplementation(async (id: number) => ({ id }));
});

describe("saveGenres", () => {
  it("saves through savePreferences with the session user", async () => {
    await expect(
      saveGenres({}, form({ genre: ["18", "35"], next: "/" })),
    ).rejects.toThrow(/^REDIRECT:\/onboarding\?step=movies/);
    expect(mocks.preferences).toHaveBeenCalledWith(client, "user-1", {
      favorite_genre_ids: [18, 35],
    });
  });

  it("stays on the page and reports saved in settings mode", async () => {
    expect(
      await saveGenres(
        {},
        form({ genre: ["18"], next: "/settings", mode: "settings" }),
      ),
    ).toEqual({ saved: true });
    expect(mocks.revalidate).toHaveBeenCalledWith("/settings");
    expect(mocks.revalidate).toHaveBeenCalledWith("/u/[username]", "layout");
  });

  it("allows clearing every genre from settings", async () => {
    expect(
      await saveGenres({}, form({ next: "/settings", mode: "settings" })),
    ).toEqual({ saved: true });
    expect(mocks.preferences).toHaveBeenCalledWith(client, "user-1", {
      favorite_genre_ids: [],
    });
  });

  it("any other mode value continues onboarding", async () => {
    await expect(
      saveGenres({}, form({ genre: ["18"], next: "/", mode: "Settings" })),
    ).rejects.toThrow(/^REDIRECT:/);
  });

  it("returns an error, not saved, when the write fails in settings mode", async () => {
    mocks.preferences.mockResolvedValue(false);
    const result = await saveGenres(
      {},
      form({ genre: ["18"], next: "/settings", mode: "settings" }),
    );
    expect(result.saved).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("rejects unknown genres before touching the database", async () => {
    expect(
      await saveGenres({}, form({ genre: ["99999"], mode: "settings" })),
    ).toEqual({ error: "Choose genres from the list." });
    expect(mocks.preferences).not.toHaveBeenCalled();
  });

  it("signed-out users get an error, not saved", async () => {
    mocks.user.mockResolvedValue(null);
    const result = await saveGenres(
      {},
      form({ genre: ["18"], mode: "settings" }),
    );
    expect(result.saved).toBeUndefined();
    expect(mocks.preferences).not.toHaveBeenCalled();
  });
});

describe("saveFavoriteMovies in settings mode", () => {
  it("caches movies, saves and reports saved", async () => {
    expect(
      await saveFavoriteMovies(
        {},
        form({ movie: ["27205", "155"], next: "/settings", mode: "settings" }),
      ),
    ).toEqual({ saved: true });
    expect(mocks.cache).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("set_favorite_movies", {
      movie_ids: [27205, 155],
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/settings");
  });

  it("allows clearing favorites without TMDB or rate limit calls", async () => {
    expect(
      await saveFavoriteMovies(
        {},
        form({ next: "/settings", mode: "settings" }),
      ),
    ).toEqual({ saved: true });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("set_favorite_movies", {
      movie_ids: [],
    });
  });

  it("does not report saved when the RPC fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "P0001" } });
    const result = await saveFavoriteMovies(
      {},
      form({ movie: ["27205"], mode: "settings" }),
    );
    expect(result.saved).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it("continues onboarding without the settings mode", async () => {
    await expect(
      saveFavoriteMovies({}, form({ movie: ["27205"], next: "/" })),
    ).rejects.toThrow(/^REDIRECT:\/onboarding\?step=finish/);
  });
});
