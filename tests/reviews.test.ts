import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Call = { table: string; ops: [string, unknown[]][] };
const mocks = vi.hoisted(() => ({
  respond: vi.fn(),
  calls: [] as Call[],
  configured: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getPublicConfig: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const call: Call = { table, ops: [] };
      mocks.calls.push(call);
      const query: Record<string, unknown> = {};
      for (const name of ["select", "eq", "not", "or", "order", "limit", "in"])
        query[name] = (...args: unknown[]) => {
          call.ops.push([name, args]);
          return query;
        };
      query.then = (resolve: (value: unknown) => void) =>
        Promise.resolve(mocks.respond(call)).then(resolve);
      return query;
    },
  }),
}));
import { decodeCursor, encodeCursor } from "@/lib/reviews/cursor";
import { loadReviews, REVIEW_PAGE_SIZE } from "@/lib/reviews/load";
import { GET } from "@/app/api/movies/[tmdbId]/reviews/route";

const at = (minute: number) =>
  `2026-09-30T01:${String(minute).padStart(2, "0")}:00.123456+00:00`;
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: id(n),
    user_id: "author-1",
    score: 8.5,
    note: `Review ${n}`,
    spoiler: false,
    created_at: at(59 - n),
    updated_at: at(59 - n),
    ...extra,
  };
}
const reviewCall = () => mocks.calls.find((c) => c.table === "public_reviews")!;

beforeEach(() => {
  mocks.respond.mockReset();
  mocks.calls.length = 0;
  mocks.configured.mockReturnValue({ siteUrl: "https://codebox.test" });
  mocks.respond.mockImplementation((call: Call) =>
    call.table === "user_identities"
      ? {
          data: [{ id: "author-1", username: "film_fan", avatar: null }],
          error: null,
        }
      : { data: Array.from({ length: 21 }, (_, n) => row(n)), error: null },
  );
});

describe("review cursors", () => {
  it("round-trip (created_at, id)", () => {
    const cursor = { createdAt: at(5), id: id(7) };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor(null)).toBeNull();
  });
  it.each([
    "not-base64-json",
    Buffer.from(`${at(5)}|not-a-uuid`).toString("base64url"),
    Buffer.from(`yesterday|${id(1)}`).toString("base64url"),
    Buffer.from(`${at(5)}|${id(1)}|extra`).toString("base64url"),
    Buffer.from(`${at(5)}"),or(id.gt.0|${id(1)}`).toString("base64url"),
  ])("reject tampered cursor %s", (value) => {
    expect(() => decodeCursor(value)).toThrow();
  });
});

describe("loadReviews", () => {
  it("reads 20 newest public reviews with keyset order and a next cursor", async () => {
    const page = await loadReviews(10, { cursor: null, writtenOnly: false });
    const call = reviewCall();
    expect(call.ops).toContainEqual(["eq", ["movie_id", 10]]);
    expect(call.ops).toContainEqual([
      "order",
      ["created_at", { ascending: false }],
    ]);
    expect(call.ops).toContainEqual(["order", ["id", { ascending: false }]]);
    expect(call.ops).toContainEqual(["limit", [REVIEW_PAGE_SIZE + 1]]);
    // Never asks for private watch metadata.
    const [[, [columns]]] = call.ops.filter(([op]) => op === "select") as [
      string,
      [string],
    ][];
    expect(columns).not.toMatch(/watched/);
    expect(page.reviews).toHaveLength(20);
    expect(page.reviews[0]).toMatchObject({
      author: { id: expect.any(String), username: "film_fan" },
      note: "Review 0",
      edited: false,
    });
    expect(decodeCursor(page.nextCursor)).toEqual({
      createdAt: row(19).created_at,
      id: row(19).id,
    });
  });
  it("continues strictly after the cursor and can require written reviews", async () => {
    const cursor = { createdAt: at(5), id: id(7) };
    await loadReviews(10, { cursor, writtenOnly: true });
    const call = reviewCall();
    expect(call.ops).toContainEqual(["not", ["note", "is", null]]);
    expect(call.ops).toContainEqual([
      "or",
      [`created_at.lt."${at(5)}",and(created_at.eq."${at(5)}",id.lt.${id(7)})`],
    ]);
  });
  it("ends pagination on a short page and marks edits", async () => {
    mocks.respond.mockImplementation((call: Call) =>
      call.table === "user_identities"
        ? {
            data: [{ id: "author-1", username: "film_fan", avatar: null }],
            error: null,
          }
        : {
            data: [row(1, { updated_at: "2026-10-02T00:00:00+00:00" })],
            error: null,
          },
    );
    const page = await loadReviews(10, { cursor: null, writtenOnly: false });
    expect(page.nextCursor).toBeNull();
    expect(page.reviews[0].edited).toBe(true);
  });
});

describe("GET /api/movies/[tmdbId]/reviews", () => {
  const request = (query: string) =>
    new NextRequest(`https://codebox.test/api/movies/10/reviews${query}`);
  const params = (tmdbId = "10") => ({ params: Promise.resolve({ tmdbId }) });
  it("returns a private, uncached page", async () => {
    const response = await GET(request("?written=1"), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reviewCall().ops).toContainEqual(["not", ["note", "is", null]]);
  });
  it("rejects a tampered cursor or movie id before querying", async () => {
    expect((await GET(request("?cursor=junk"), params())).status).toBe(400);
    expect((await GET(request(""), params("abc"))).status).toBe(400);
    expect(mocks.calls).toHaveLength(0);
  });
});
