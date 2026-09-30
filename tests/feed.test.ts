import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Call = { table: string; ops: [string, unknown[]][] };
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rows: vi.fn(),
  calls: [] as Call[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getPublicConfig: () => ({ url: "x" }) }));
vi.mock("@/lib/auth/user", () => ({ getUser: mocks.user }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const call: Call = { table, ops: [] };
      mocks.calls.push(call);
      const query: Record<string, unknown> = {};
      for (const name of ["select", "in", "or", "order", "limit", "eq"])
        query[name] = (...args: unknown[]) => {
          call.ops.push([name, args]);
          return query;
        };
      query.then = (resolve: (value: unknown) => void) =>
        Promise.resolve({ data: mocks.rows(call), error: null }).then(resolve);
      return query;
    },
  }),
}));
import { loadFeed } from "@/lib/feed/load";
import { GET } from "@/app/api/feed/route";
import { decodeCursor, encodeCursor } from "@/lib/reviews/cursor";
import { FEED_PAGE_SIZE } from "@/lib/feed/types";

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  entry_id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  kind: "rated",
  created_at: `2026-09-${String(30 - (n % 28)).padStart(2, "0")}T10:00:00+00:00`,
  username: "film_fan",
  avatar: null,
  movie_id: 603,
  title: "The Matrix",
  poster: "/m.jpg",
  year: 1999,
  score: 8.5,
  ...extra,
});
const ops = (name: string) =>
  mocks.calls.flatMap((call) => call.ops.filter(([op]) => op === name));

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.user.mockReset();
  mocks.rows.mockReset();
  mocks.rows.mockReturnValue([row(1)]);
});

describe("loadFeed", () => {
  it("reads Following from following_feed and Community as public ratings/reviews only", async () => {
    await loadFeed("following", null);
    await loadFeed("community", null);
    expect(mocks.calls.map((call) => call.table)).toEqual([
      "following_feed",
      "activity_feed",
    ]);
    expect(ops("in")).toEqual([["in", ["kind", ["rated", "reviewed"]]]]);
    const [[, [columns]]] = ops("select") as [string, [string]][];
    expect(columns).not.toMatch(/note|spoiler|watched_date/);
  });
  it("orders by (created_at, id) and continues strictly after the cursor", async () => {
    const cursor = { createdAt: "2026-09-30T10:00:00+00:00", id: row(5).id };
    await loadFeed("community", cursor);
    expect(ops("order")).toEqual([
      ["order", ["created_at", { ascending: false }]],
      ["order", ["id", { ascending: false }]],
    ]);
    expect(ops("or")[0][1][0]).toBe(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`,
    );
    expect(ops("limit")).toEqual([["limit", [FEED_PAGE_SIZE + 1]]]);
  });
  it("returns a next cursor only when there is another page", async () => {
    const rows = Array.from({ length: FEED_PAGE_SIZE + 1 }, (_, n) =>
      row(n + 1),
    );
    mocks.rows.mockReturnValue(rows);
    const page = await loadFeed("community", null);
    expect(page.items).toHaveLength(FEED_PAGE_SIZE);
    expect(decodeCursor(page.nextCursor)).toEqual({
      createdAt: rows[FEED_PAGE_SIZE - 1].created_at,
      id: rows[FEED_PAGE_SIZE - 1].id,
    });
    mocks.rows.mockReturnValue([row(1)]);
    expect((await loadFeed("community", null)).nextCursor).toBeNull();
  });
  it("maps only safe fields into cards", async () => {
    mocks.rows.mockReturnValue([
      row(1, { kind: "reviewed", score: null, note: "The twist is X" }),
    ]);
    const [item] = (await loadFeed("community", null)).items;
    expect(item).toEqual({
      id: row(1).id,
      entryId: row(1).entry_id,
      kind: "reviewed",
      createdAt: row(1).created_at,
      user: { username: "film_fan", avatar: null },
      movie: { id: 603, title: "The Matrix", poster: "/m.jpg", year: 1999 },
      score: null,
    });
    expect(JSON.stringify(item)).not.toContain("twist");
  });
});

describe("GET /api/feed", () => {
  const get = (query: string) =>
    GET(new NextRequest(`https://codebox.test/api/feed?${query}`));
  it("validates the tab and cursor", async () => {
    expect((await get("tab=everyone")).status).toBe(400);
    expect((await get("tab=community&cursor=junk")).status).toBe(400);
  });
  it("requires sign-in for Following but not Community, never cached", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await get("tab=following")).status).toBe(401);
    const response = await get(
      `tab=community&cursor=${encodeCursor({ createdAt: "2026-09-30T10:00:00Z", id: row(2).id })}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).items).toHaveLength(1);
  });
});
