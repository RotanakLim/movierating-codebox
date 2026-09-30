import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; ops: [string, unknown[]][] };
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  respond: vi.fn(),
  calls: [] as Call[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getPublicConfig: () => ({ url: "x" }) }));
const client = {
  rpc: mocks.rpc,
  from(table: string) {
    const call: Call = { table, ops: [] };
    mocks.calls.push(call);
    const query: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "or", "order", "limit"])
      query[name] = (...args: unknown[]) => {
        call.ops.push([name, args]);
        return query;
      };
    query.then = (resolve: (value: unknown) => void) =>
      Promise.resolve(mocks.respond(call)).then(resolve);
    return query;
  },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
import { findPeople, peopleQuery } from "@/lib/people/load";
import { loadInbox } from "@/lib/people/inbox";

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.rpc.mockReset();
  mocks.respond.mockReset();
});

describe("people search", () => {
  it("accepts usernames (with or without @) and rejects anything else", () => {
    expect(peopleQuery(" @Film_Fan ")).toEqual({
      term: "film_fan",
      valid: true,
    });
    expect(peopleQuery(undefined)).toEqual({ term: "", valid: true });
    expect(peopleQuery("50%").valid).toBe(false);
    expect(peopleQuery("a".repeat(25)).valid).toBe(false);
  });
  it("searches by prefix, or discovers public profiles when empty", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: "u1",
          username: "film_fan",
          avatar: null,
          visibility: "private",
          display_name: null,
          follow_status: "pending",
          last_active: null,
        },
      ],
      error: null,
    });
    expect(await findPeople("film")).toEqual([
      {
        id: "u1",
        username: "film_fan",
        avatar: null,
        visibility: "private",
        displayName: null,
        followStatus: "pending",
      },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("find_people", {
      search: "film",
      max_rows: 30,
    });
    await findPeople("");
    expect(mocks.rpc).toHaveBeenLastCalledWith("find_people", { max_rows: 30 });
  });
});

describe("follow inbox", () => {
  it("splits requests, recent followers (with follow-back state) and sent requests, dropping blocked accounts", async () => {
    mocks.respond.mockImplementation((call: Call) => {
      if (call.table === "user_identities")
        return {
          data: [
            { id: "a", username: "asker", avatar: null },
            { id: "b", username: "fan", avatar: null },
            { id: "c", username: "crush", avatar: null },
          ],
        };
      const inbound = call.ops.some(
        ([op, args]) => op === "eq" && args[0] === "following_id",
      );
      return inbound
        ? {
            data: [
              {
                follower_id: "a",
                status: "pending",
                updated_at: "2026-09-30T00:00:00Z",
              },
              {
                follower_id: "b",
                status: "accepted",
                updated_at: "2026-09-29T00:00:00Z",
              },
              {
                follower_id: "blocked",
                status: "accepted",
                updated_at: "2026-09-29T00:00:00Z",
              },
            ],
          }
        : {
            data: [
              {
                following_id: "c",
                status: "pending",
                updated_at: "2026-09-28T00:00:00Z",
              },
              {
                following_id: "b",
                status: "declined",
                updated_at: "2026-09-27T00:00:00Z",
              },
            ],
          };
    });
    const inbox = await loadInbox(client as never, "me");
    expect(inbox.requests.map((p) => p.username)).toEqual(["asker"]);
    expect(inbox.followers).toEqual([
      {
        id: "b",
        username: "fan",
        avatar: null,
        at: "2026-09-29T00:00:00Z",
        followBack: null,
      },
    ]);
    expect(inbox.sent.map((p) => p.username)).toEqual(["crush"]);
    const inboundFilter = mocks.calls[0].ops.find(([op]) => op === "or")![1][0];
    expect(inboundFilter).toMatch(
      /^status\.eq\.pending,and\(status\.eq\.accepted,updated_at\.gte\."\d{4}-/,
    );
  });
});
