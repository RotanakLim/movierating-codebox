import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; ops: [string, unknown[]][] };
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  username: vi.fn(),
  limit: vi.fn(),
  details: vi.fn(),
  cache: vi.fn(),
  // Decides what each finished query resolves to.
  respond: vi.fn(),
  calls: [] as Call[],
  suspended: vi.fn(() => false),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/user", () => ({ getUser: mocks.user }));
vi.mock("@/lib/onboarding/profile", () => ({ readUsername: mocks.username }));
vi.mock("@/lib/movies/limits", () => ({ limitMovieRequest: mocks.limit }));
vi.mock("@/lib/movies/tmdb", () => ({ getMovieDetails: mocks.details }));
vi.mock("@/lib/supabase/movie-cache", () => ({ cacheMovie: mocks.cache }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string) =>
      name === "my_account_suspended"
        ? { data: mocks.suspended(), error: null }
        : { data: null, error: null },
    from(table: string) {
      const call: Call = { table, ops: [] };
      mocks.calls.push(call);
      const query: Record<string, unknown> = {};
      for (const name of ["select", "insert", "update", "eq", "order"])
        query[name] = (...args: unknown[]) => {
          call.ops.push([name, args]);
          return query;
        };
      query.single = query.maybeSingle = async () => mocks.respond(call);
      query.then = (resolve: (value: unknown) => void) =>
        Promise.resolve(mocks.respond(call)).then(resolve);
      return query;
    },
  }),
}));
import { saveEntry } from "@/app/entries/actions";

const ID = "3f8f7c4e-2b1a-4c5d-9e8f-0a1b2c3d4e5f";
const valid = {
  id: ID,
  movieId: 693134,
  expectedVersion: null,
  score: 9.5,
  note: "  Line one\r\nLine two  ",
  spoiler: false,
  watched: true,
  watchedDate: "2026-01-10",
  timeZone: "America/New_York",
};
const ops = (table: string, name: string) =>
  mocks.calls
    .filter((call) => call.table === table)
    .flatMap((call) => call.ops.filter(([op]) => op === name));

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
  mocks.respond.mockImplementation((call: Call) =>
    call.table === "movies"
      ? { data: { tmdb_id: 693134 }, error: null }
      : call.ops.some(([op]) => op === "update")
        ? { data: [{ id: ID, version: 3 }], error: null }
        : { data: { id: ID, version: 1 }, error: null },
  );
});

describe("saveEntry validation (before any database call)", () => {
  it.each([
    ["negative", -0.1],
    ["above ten", 10.1],
    ["10.5", 10.5],
    ["two decimals", 9.55],
    ["0.05", 0.05],
    ["not a number", Number.NaN],
    ["a string", "9"],
  ])("rejects a %s score", async (_label, score) => {
    const result = await saveEntry({ ...valid, score });
    expect(result).toMatchObject({ ok: false, code: "INVALID" });
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.calls).toHaveLength(0);
  });
  it.each([
    ["a watch date on an unwatched entry", { watched: false }],
    ["a future watch date", { watchedDate: "2999-01-01" }],
    ["an impossible date", { watchedDate: "2026-02-30" }],
    ["a review over 5,000 characters", { note: "x".repeat(5001) }],
    [
      "an empty entry",
      { watched: false, watchedDate: null, score: null, note: "   " },
    ],
    ["an unknown timezone", { timeZone: "Mars/Olympus" }],
    ["a malformed id", { id: "not-a-uuid" }],
    ["an owner field", { user_id: "someone-else" }],
  ])("rejects %s", async (_label, change) => {
    const result = await saveEntry({ ...valid, ...change });
    expect(result).toMatchObject({ ok: false, code: "INVALID" });
    expect(mocks.calls).toHaveLength(0);
  });
});

describe("saveEntry entry shapes", () => {
  it.each([
    ["watched-only", { score: null, note: "" }],
    ["rating-only", { note: "", watched: false, watchedDate: null }],
    ["review-only", { score: null, watched: false, watchedDate: null }],
    ["full", {}],
    ["watched with the date unknown", { watchedDate: null }],
    ["boundary score 0.0", { score: 0 }],
    ["boundary score 10.0", { score: 10 }],
  ])("saves a %s entry", async (_label, change) => {
    const result = await saveEntry({ ...valid, ...change });
    expect(result).toEqual({ ok: true, entry: { id: ID, version: 1 } });
  });
  it("reports the retry time when the new-entry limit is reached", async () => {
    mocks.respond.mockImplementation((call: Call) =>
      call.table === "movies"
        ? { data: { tmdb_id: 693134 }, error: null }
        : { data: null, error: { code: "PT429", details: "725" } },
    );
    expect(await saveEntry(valid)).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      error:
        "You've added a lot of entries recently. Try again in 13 minutes. Your draft is kept.",
      retryAfter: 725,
    });
  });
  it("refuses suspended accounts before writing", async () => {
    mocks.suspended.mockReturnValue(true);
    expect(await saveEntry(valid)).toMatchObject({
      ok: false,
      code: "SUSPENDED",
    });
    expect(ops("entries", "insert")).toHaveLength(0);
  });
  it("inserts with the client UUID and no owner, keeping line breaks", async () => {
    await saveEntry(valid);
    expect(ops("entries", "insert")).toEqual([
      [
        "insert",
        [
          {
            id: ID,
            movie_id: 693134,
            score: 9.5,
            note: "Line one\nLine two",
            spoiler: false,
            watched: true,
            watched_date: "2026-01-10",
            watched_timezone: "America/New_York",
          },
        ],
      ],
    ]);
  });
});

describe("saveEntry sign-in and setup checks", () => {
  it("asks guests to sign in", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await saveEntry(valid)).toMatchObject({
      ok: false,
      code: "SIGN_IN_REQUIRED",
    });
    expect(mocks.calls).toHaveLength(0);
  });
  it("requires a verified email", async () => {
    mocks.user.mockResolvedValue({ id: "user-1", email_confirmed_at: null });
    expect(await saveEntry(valid)).toMatchObject({
      code: "VERIFICATION_REQUIRED",
    });
  });
  it("requires a username", async () => {
    mocks.username.mockResolvedValue(null);
    expect(await saveEntry(valid)).toMatchObject({ code: "USERNAME_REQUIRED" });
    expect(ops("entries", "insert")).toHaveLength(0);
  });
});

describe("saveEntry movie cache", () => {
  it("does not re-cache a movie that is already cached", async () => {
    mocks.details.mockResolvedValue({
      id: 693134,
      availableFrom: "2024-02-28",
    });
    await saveEntry(valid);
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("rejects entries before the earliest known release date", async () => {
    mocks.details.mockResolvedValue({
      id: 693134,
      availableFrom: "2999-01-01",
    });
    const result = await saveEntry(valid);
    expect(result).toMatchObject({ ok: false, code: "NOT_RELEASED" });
    expect(result.ok || result.error).toContain("Jan 1, 2999");
    expect(ops("entries", "insert")).toHaveLength(0);
  });
  it("uses the viewer's timezone for the release day", async () => {
    // Released "today" in Tokyo, still "tomorrow" in Los Angeles at this instant.
    vi.useFakeTimers({
      now: new Date("2026-09-30T20:00:00Z"),
      toFake: ["Date"],
    });
    mocks.details.mockResolvedValue({
      id: 693134,
      availableFrom: "2026-10-01",
    });
    try {
      expect(
        await saveEntry({
          ...valid,
          timeZone: "Asia/Tokyo",
          watchedDate: null,
        }),
      ).toMatchObject({ ok: true });
      expect(
        await saveEntry({
          ...valid,
          timeZone: "America/Los_Angeles",
          watchedDate: null,
        }),
      ).toMatchObject({ code: "NOT_RELEASED" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not block entries when the release date is unknown or TMDB is down", async () => {
    mocks.details.mockResolvedValue({ id: 693134, availableFrom: null });
    expect(await saveEntry(valid)).toMatchObject({ ok: true });
    mocks.details.mockRejectedValue(new Error("TMDB down"));
    expect(await saveEntry(valid)).toMatchObject({ ok: true });
  });
  it("caches TMDB metadata first when the movie is missing", async () => {
    mocks.respond.mockImplementation((call: Call) =>
      call.table === "movies"
        ? { data: null, error: null }
        : { data: { id: ID, version: 1 }, error: null },
    );
    mocks.details.mockResolvedValue({ id: 693134 });
    await saveEntry(valid);
    expect(mocks.limit).toHaveBeenCalledWith(
      "selection",
      expect.any(Headers),
      "user-1",
    );
    expect(mocks.cache).toHaveBeenCalledWith({ id: 693134 });
  });
});

describe("saveEntry retries and conflicts", () => {
  it("treats a retried create of an already-saved entry as saved", async () => {
    mocks.respond.mockImplementation((call: Call) => {
      if (call.table === "movies") return { data: { tmdb_id: 1 }, error: null };
      if (call.ops.some(([op]) => op === "insert"))
        return { data: null, error: { code: "23505" } };
      return { data: { id: ID, version: 1 }, error: null };
    });
    expect(await saveEntry(valid)).toEqual({
      ok: true,
      entry: { id: ID, version: 1 },
    });
    const lookup = mocks.calls.find(
      (call) =>
        call.table === "entries" && !call.ops.some(([op]) => op === "insert"),
    )!;
    expect(lookup.ops).toContainEqual(["eq", ["user_id", "user-1"]]);
  });
  it("updates only the expected version of the entry", async () => {
    const result = await saveEntry({ ...valid, expectedVersion: 2 });
    expect(result).toEqual({ ok: true, entry: { id: ID, version: 3 } });
    const update = mocks.calls.find((call) =>
      call.ops.some(([op]) => op === "update"),
    )!;
    expect(update.ops).toContainEqual(["eq", ["id", ID]]);
    expect(update.ops).toContainEqual(["eq", ["version", 2]]);
  });
  it("reports a conflict when the entry changed elsewhere", async () => {
    mocks.respond.mockImplementation((call: Call) =>
      call.table === "movies"
        ? { data: { tmdb_id: 1 }, error: null }
        : { data: [], error: null },
    );
    const result = await saveEntry({ ...valid, expectedVersion: 2 });
    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(result.ok || result.error).toContain("Reload");
  });
  it("clears the watch date of an unwatched update", async () => {
    await saveEntry({
      ...valid,
      expectedVersion: 1,
      watched: false,
      watchedDate: null,
    });
    const [[, [fields]]] = ops("entries", "update") as [
      string,
      [Record<string, unknown>],
    ][];
    expect(fields).toMatchObject({ watched: false, watched_date: null });
  });
});
