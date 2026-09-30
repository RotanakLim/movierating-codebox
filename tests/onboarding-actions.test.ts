import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  username: vi.fn(),
  limit: vi.fn(),
  details: vi.fn(),
  cache: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from: () => ({
      update: (values: unknown) => ({
        eq: (_column: string, id: string) => ({
          is: () => ({ select: () => mocks.update(values, id) }),
        }),
      }),
    }),
  }),
}));
import {
  checkUsername,
  claimUsername,
  saveFavoriteMovies,
} from "@/app/onboarding/actions";

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
});

describe("checkUsername", () => {
  it("rejects bad and reserved names without a database call", async () => {
    expect(await checkUsername("ab")).toBe("invalid");
    expect(await checkUsername("Admin")).toBe("reserved");
    expect(await checkUsername(42)).toBe("invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("asks the database about a well-formed name, normalized", async () => {
    mocks.rpc.mockResolvedValue({ data: "taken", error: null });
    expect(await checkUsername("  Film_Fan ")).toBe("taken");
    expect(mocks.rpc).toHaveBeenCalledWith("username_status", {
      candidate: "  Film_Fan ",
    });
  });
  it("requires a signed-in user", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await checkUsername("film_fan")).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("claimUsername", () => {
  it("validates before touching the database", async () => {
    expect(
      (await claimUsername({}, form({ username: "bad-name" }))).error,
    ).toContain("lowercase");
    expect(
      (await claimUsername({}, form({ username: "settings" }))).error,
    ).toContain("reserved");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("reports a duplicate that won the race after the availability check", async () => {
    mocks.update.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    expect(
      (await claimUsername({}, form({ username: "film_fan" }))).error,
    ).toBe("That username is taken. Try another.");
  });
  it("saves the normalized name for the session user only and continues", async () => {
    mocks.update.mockResolvedValue({
      data: [{ username: "film_fan" }],
      error: null,
    });
    await expect(
      claimUsername(
        {},
        form({
          username: " Film_Fan ",
          next: "/movies/10",
          user_id: "someone-else",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding?step=genres&next=%2Fmovies%2F10");
    expect(mocks.update).toHaveBeenCalledWith(
      { username: "film_fan" },
      "user-1",
    );
  });
  it("drops an unsafe next path", async () => {
    mocks.update.mockResolvedValue({ data: [{}], error: null });
    await expect(
      claimUsername({}, form({ username: "film_fan", next: "//evil.test" })),
    ).rejects.toThrow("REDIRECT:/onboarding?step=genres");
  });
  it("requires a session", async () => {
    mocks.user.mockResolvedValue(null);
    expect(
      (await claimUsername({}, form({ username: "film_fan" }))).error,
    ).toContain("Sign in");
  });
});

describe("saveFavoriteMovies", () => {
  it("rejects more than five or duplicate movies before any provider call", async () => {
    expect(
      (
        await saveFavoriteMovies(
          {},
          form({ movie: ["1", "2", "3", "4", "5", "6"] }),
        )
      ).error,
    ).toContain("five");
    expect(
      (await saveFavoriteMovies({}, form({ movie: ["7", "7"] }))).error,
    ).toContain("once");
    expect(mocks.details).not.toHaveBeenCalled();
  });
  it("caches TMDB metadata then replaces favorites, never creating entries", async () => {
    mocks.details.mockImplementation(async (id: number) => ({ id }));
    mocks.rpc.mockResolvedValue({ error: null });
    await expect(
      saveFavoriteMovies({}, form({ movie: ["27205", "155"] })),
    ).rejects.toThrow("REDIRECT:/onboarding?step=finish");
    expect(mocks.limit).toHaveBeenCalledOnce();
    expect(mocks.cache).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("set_favorite_movies", {
      movie_ids: [27205, 155],
    });
  });
  it("sends a user without a username back to step one", async () => {
    mocks.username.mockResolvedValue(null);
    await expect(
      saveFavoriteMovies({}, form({ movie: ["27205"] })),
    ).rejects.toThrow("REDIRECT:/onboarding");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
