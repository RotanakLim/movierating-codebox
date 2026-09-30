import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; ops: [string, unknown[]][] };
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  username: vi.fn(),
  ensure: vi.fn(),
  respond: vi.fn(),
  calls: [] as Call[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({ getUser: mocks.user }));
vi.mock("@/lib/onboarding/profile", () => ({ readUsername: mocks.username }));
vi.mock("@/lib/movies/ensure-cached", () => ({
  ensureMovieCached: mocks.ensure,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const call: Call = { table, ops: [] };
      mocks.calls.push(call);
      const query: Record<string, unknown> = {};
      for (const name of ["select", "insert", "delete", "eq"])
        query[name] = (...args: unknown[]) => {
          call.ops.push([name, args]);
          return query;
        };
      query.maybeSingle = async () => mocks.respond(call);
      query.then = (resolve: (value: unknown) => void) =>
        Promise.resolve(mocks.respond(call)).then(resolve);
      return query;
    },
  }),
}));
import { setWatchlisted } from "@/app/watchlist/actions";
import { MovieError } from "@/lib/movies/errors";

const LIST = "20000000-0000-4000-8000-000000000001";
const op = (table: string, name: string) =>
  mocks.calls
    .filter((call) => call.table === table)
    .flatMap((call) => call.ops.filter(([o]) => o === name));

beforeEach(() => {
  Object.values(mocks).forEach(
    (mock) => typeof mock === "function" && mock.mockReset(),
  );
  mocks.calls.length = 0;
  mocks.user.mockResolvedValue({
    id: "user-1",
    email_confirmed_at: "2026-09-30",
  });
  mocks.username.mockResolvedValue("film_fan");
  mocks.ensure.mockResolvedValue({ availableFrom: "2999-01-01" });
  mocks.respond.mockImplementation((call: Call) =>
    call.table === "lists"
      ? { data: { id: LIST }, error: null }
      : { data: null, error: null },
  );
});

describe("setWatchlisted", () => {
  it("adds an unreleased movie to the session user's watchlist", async () => {
    expect(await setWatchlisted({ movieId: 10, watchlisted: true })).toEqual({
      ok: true,
      watchlisted: true,
    });
    expect(mocks.ensure).toHaveBeenCalledWith(expect.anything(), 10, "user-1");
    expect(op("lists", "eq")).toContainEqual(["eq", ["user_id", "user-1"]]);
    expect(op("list_items", "insert")).toEqual([
      ["insert", [{ list_id: LIST, movie_id: 10 }]],
    ]);
  });
  it("treats an item that is already there as success", async () => {
    mocks.respond.mockImplementation((call: Call) =>
      call.table === "lists"
        ? { data: { id: LIST }, error: null }
        : { data: null, error: { code: "23505" } },
    );
    expect(await setWatchlisted({ movieId: 10, watchlisted: true })).toEqual({
      ok: true,
      watchlisted: true,
    });
  });
  it("removes without touching the movie cache", async () => {
    expect(await setWatchlisted({ movieId: 10, watchlisted: false })).toEqual({
      ok: true,
      watchlisted: false,
    });
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(op("list_items", "eq")).toEqual([
      ["eq", ["list_id", LIST]],
      ["eq", ["movie_id", 10]],
    ]);
  });
  it.each([
    [{ movieId: -1, watchlisted: true }],
    [{ movieId: 10, watchlisted: "yes" }],
    [{ movieId: 10, watchlisted: true, listId: "someone-elses" }],
  ])("rejects invalid input %j before any database call", async (input) => {
    expect(await setWatchlisted(input)).toMatchObject({ code: "INVALID" });
    expect(mocks.calls).toHaveLength(0);
  });
  it("requires sign-in, a verified email and a username", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect(
      await setWatchlisted({ movieId: 10, watchlisted: true }),
    ).toMatchObject({ code: "SIGN_IN_REQUIRED" });
    mocks.user.mockResolvedValueOnce({
      id: "user-1",
      email_confirmed_at: null,
    });
    expect(
      await setWatchlisted({ movieId: 10, watchlisted: true }),
    ).toMatchObject({ code: "VERIFICATION_REQUIRED" });
    mocks.username.mockResolvedValueOnce(null);
    expect(
      await setWatchlisted({ movieId: 10, watchlisted: true }),
    ).toMatchObject({ code: "USERNAME_REQUIRED" });
    expect(op("list_items", "insert")).toHaveLength(0);
  });
  it("reports a movie TMDB no longer has", async () => {
    mocks.ensure.mockRejectedValue(
      new MovieError(404, "gone", "MOVIE_NOT_FOUND"),
    );
    expect(
      await setWatchlisted({ movieId: 10, watchlisted: true }),
    ).toMatchObject({ ok: false, code: "INVALID" });
    expect(op("list_items", "insert")).toHaveLength(0);
  });
});
