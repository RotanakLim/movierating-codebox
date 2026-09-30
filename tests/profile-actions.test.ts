import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; ops: [string, unknown[]][] };
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  username: vi.fn(),
  rpc: vi.fn(),
  ensure: vi.fn(),
  respond: vi.fn(),
  calls: [] as Call[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ getUser: mocks.user }));
vi.mock("@/lib/onboarding/profile", () => ({ readUsername: mocks.username }));
vi.mock("@/lib/movies/ensure-cached", () => ({
  ensureMovieCached: mocks.ensure,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from(table: string) {
      const call: Call = { table, ops: [] };
      mocks.calls.push(call);
      const query: Record<string, unknown> = {};
      for (const name of ["select", "insert", "update", "delete", "eq"])
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
import {
  block,
  follow,
  reportUser,
  setVisibility,
  unfollow,
} from "@/app/profiles/actions";
import {
  createList,
  deleteList,
  setListMembership,
  updateList,
} from "@/app/lists/actions";
import { deleteEntry } from "@/app/entries/actions";

const OTHER = "00000000-0000-4000-8000-000000000002";
const LIST = "40000000-0000-4000-8000-000000000001";
const ops = (table: string, name: string) =>
  mocks.calls
    .filter((call) => call.table === table)
    .flatMap((call) => call.ops.filter(([op]) => op === name));

beforeEach(() => {
  Object.values(mocks).forEach(
    (mock) => typeof mock === "function" && mock.mockReset(),
  );
  mocks.calls.length = 0;
  mocks.user.mockResolvedValue({ id: "me", email_confirmed_at: "2026-09-30" });
  mocks.username.mockResolvedValue("film_fan");
  mocks.respond.mockResolvedValue({ data: [{ id: LIST }], error: null });
});

describe("follow and unfollow", () => {
  it("returns the database's decision (accepted for public, pending otherwise)", async () => {
    mocks.rpc.mockResolvedValue({ data: "pending", error: null });
    expect(await follow({ userId: OTHER })).toEqual({
      ok: true,
      status: "pending",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("request_follow", {
      target_id: OTHER,
    });
  });
  it("explains the 24-hour cooldown after a decline", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "Please wait 24 hours before requesting again",
      },
    });
    expect(await follow({ userId: OTHER })).toMatchObject({
      ok: false,
      error: expect.stringContaining("24 hours"),
    });
  });
  it("requires a verified, onboarded user", async () => {
    mocks.username.mockResolvedValue(null);
    expect(await follow({ userId: OTHER })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("unfollows or cancels a request through the outgoing RPC", async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    expect(await unfollow({ userId: OTHER })).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("remove_follow", {
      other_id: OTHER,
      direction: "outgoing",
    });
  });
  it("rejects malformed ids", async () => {
    expect(await follow({ userId: "me" })).toMatchObject({ ok: false });
    expect(await follow({ userId: OTHER, extra: 1 })).toMatchObject({
      ok: false,
    });
  });
});

describe("block and report", () => {
  it("blocks without a client-supplied blocker id", async () => {
    mocks.respond.mockResolvedValue({ error: null });
    expect(await block({ userId: OTHER })).toEqual({ ok: true });
    expect(ops("blocks", "insert")).toEqual([
      ["insert", [{ blocked_id: OTHER }]],
    ]);
  });
  it("refuses to block or report yourself", async () => {
    mocks.user.mockResolvedValue({ id: OTHER, email_confirmed_at: "x" });
    expect(await block({ userId: OTHER })).toMatchObject({ ok: false });
    expect(
      await reportUser({ userId: OTHER, reason: "spam", details: "" }),
    ).toMatchObject({ ok: false });
    expect(mocks.calls.filter((c) => c.table !== "users")).toHaveLength(0);
  });
  it("files a report and returns a short receipt", async () => {
    mocks.respond.mockResolvedValue({ error: null });
    const result = await reportUser({
      userId: OTHER,
      reason: "harassment",
      details: "  Rude replies  ",
    });
    expect(result).toMatchObject({
      ok: true,
      receipt: expect.stringMatching(/^[0-9A-F]{8}$/),
    });
    const [[, [row]]] = ops("reports", "insert") as [
      string,
      [Record<string, unknown>],
    ][];
    expect(row).toMatchObject({
      target_user_id: OTHER,
      reason: "harassment",
      details: "Rude replies",
    });
    expect(row).not.toHaveProperty("reporter_id");
  });
  it("reports one open report per target clearly", async () => {
    mocks.respond.mockResolvedValue({ error: { code: "23505" } });
    expect(
      await reportUser({ userId: OTHER, reason: "spam", details: "" }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("already") });
  });
  it("validates the reason and detail length", async () => {
    expect(
      await reportUser({ userId: OTHER, reason: "boring", details: "" }),
    ).toMatchObject({ ok: false });
    expect(
      await reportUser({
        userId: OTHER,
        reason: "other",
        details: "x".repeat(1001),
      }),
    ).toMatchObject({ ok: false });
    expect(ops("reports", "insert")).toHaveLength(0);
  });
});

describe("privacy setting", () => {
  it("updates only the signed-in user's own row", async () => {
    mocks.respond.mockResolvedValue({ error: null });
    expect(await setVisibility({ visibility: "friends" })).toEqual({
      ok: true,
    });
    expect(ops("users", "eq")).toContainEqual(["eq", ["id", "me"]]);
    expect(await setVisibility({ visibility: "secret" })).toMatchObject({
      ok: false,
    });
  });
});

describe("custom lists", () => {
  it("creates a list with trimmed name and no client owner", async () => {
    mocks.respond.mockResolvedValue({ data: { id: LIST }, error: null });
    expect(
      await createList({ name: "  Comfort films ", description: "" }),
    ).toEqual({
      ok: true,
      id: LIST,
    });
    expect(ops("lists", "insert")).toEqual([
      ["insert", [{ name: "Comfort films", description: null }]],
    ]);
  });
  it.each([
    [{ name: "   ", description: "" }],
    [{ name: "x".repeat(101), description: "" }],
    [{ name: "Fine", description: "x".repeat(501) }],
    [{ name: "Fine", description: "", user_id: "someone" }],
  ])("rejects invalid list input %#", async (input) => {
    expect(await createList(input)).toMatchObject({ ok: false });
    expect(mocks.calls).toHaveLength(0);
  });
  it("renames and deletes only the owner's custom lists", async () => {
    expect(
      await updateList({ id: LIST, name: "New", description: "" }),
    ).toEqual({ ok: true });
    mocks.respond.mockResolvedValue({ error: null });
    expect(await deleteList({ id: LIST })).toEqual({ ok: true });
    for (const name of ["update", "delete"]) {
      const call = mocks.calls.find((c) => c.ops.some(([op]) => op === name))!;
      expect(call.ops).toContainEqual(["eq", ["user_id", "me"]]);
      expect(call.ops).toContainEqual(["eq", ["kind", "custom"]]);
    }
  });
  it("caches the movie before adding it to a list", async () => {
    mocks.respond.mockImplementation((call: Call) =>
      call.ops.some(([op]) => op === "insert")
        ? { error: { code: "23505" } }
        : { data: { id: LIST }, error: null },
    );
    expect(
      await setListMembership({ listId: LIST, movieId: 10, included: true }),
    ).toEqual({ ok: true });
    expect(mocks.ensure).toHaveBeenCalledWith(expect.anything(), 10, "me");
  });
  it("refuses lists the user doesn't own", async () => {
    mocks.respond.mockResolvedValue({ data: null, error: null });
    expect(
      await setListMembership({ listId: LIST, movieId: 10, included: true }),
    ).toMatchObject({ ok: false });
    expect(ops("list_items", "insert")).toHaveLength(0);
  });
});

describe("deleteEntry", () => {
  it("deletes only the session user's entry", async () => {
    expect(await deleteEntry({ id: LIST })).toEqual({ ok: true });
    const call = mocks.calls.find((c) => c.table === "entries")!;
    expect(call.ops).toContainEqual(["eq", ["id", LIST]]);
    expect(call.ops).toContainEqual(["eq", ["user_id", "me"]]);
  });
  it("says so when the entry is already gone", async () => {
    mocks.respond.mockResolvedValue({ data: [], error: null });
    expect(await deleteEntry({ id: LIST })).toMatchObject({
      ok: false,
      error: expect.stringContaining("already"),
    });
  });
});
