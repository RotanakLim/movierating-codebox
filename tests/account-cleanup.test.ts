import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({ url: "https://db.codebox.test" }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import {
  cleanUpDeletedAccount,
  processAccountDeletions,
} from "@/lib/supabase/account-cleanup";
import { GET } from "@/app/api/cron/account-deletions/route";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const recorded = () =>
  mocks.rpc.mock.calls.filter(
    ([name]) => name === "record_account_deletion_attempt",
  );

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("CRON_SECRET", "c".repeat(40));
  mocks.createClient.mockReturnValue({
    rpc: mocks.rpc,
    storage: { from: () => ({ list: mocks.list, remove: mocks.remove }) },
    auth: { admin: { deleteUser: mocks.deleteUser } },
  });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.list.mockResolvedValue({ data: [], error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("account cleanup", () => {
  it("removes every avatar file, then the auth identity, then records success", async () => {
    mocks.list
      .mockResolvedValueOnce({
        data: [{ name: "a.webp" }, { name: "b.webp" }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });
    expect(await cleanUpDeletedAccount(A)).toBe(true);
    expect(mocks.list).toHaveBeenCalledWith(A, { limit: 100 });
    expect(mocks.remove).toHaveBeenCalledWith([`${A}/a.webp`, `${A}/b.webp`]);
    expect(mocks.deleteUser).toHaveBeenCalledWith(A);
    expect(recorded()).toEqual([
      ["record_account_deletion_attempt", { target: A }],
    ]);
  });

  it("treats an already-deleted auth user as done (idempotent retry)", async () => {
    mocks.deleteUser.mockResolvedValue({ error: { status: 404 } });
    expect(await cleanUpDeletedAccount(A)).toBe(true);
    expect(recorded()[0][1]).toEqual({ target: A });
  });

  it("keeps a failed cleanup queued with a short reason", async () => {
    mocks.deleteUser.mockResolvedValue({ error: { status: 500 } });
    expect(await cleanUpDeletedAccount(A)).toBe(false);
    expect(recorded()[0][1]).toEqual({
      target: A,
      failure: "auth deletion failed",
    });
    mocks.list.mockResolvedValue({ data: null, error: { status: 500 } });
    expect(await cleanUpDeletedAccount(A)).toBe(false);
    expect(recorded()[1][1].failure).toBe("avatar listing failed");
  });

  it("does nothing without the service-role key", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await cleanUpDeletedAccount(A)).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
    await expect(processAccountDeletions()).rejects.toThrow();
  });

  it("retries every queued account and continues past failures", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "pending_account_deletions"
        ? {
            data: [
              { user_id: A, attempts: 2 },
              { user_id: B, attempts: 0 },
            ],
            error: null,
          }
        : { data: null, error: null },
    );
    mocks.deleteUser
      .mockResolvedValueOnce({ error: { status: 500 } })
      .mockResolvedValueOnce({ error: null });
    expect(await processAccountDeletions()).toEqual({
      processed: 2,
      completed: 1,
    });
    expect(recorded().map(([, args]) => args.target)).toEqual([A, B]);
  });
});

describe("GET /api/cron/account-deletions", () => {
  const call = (authorization?: string) =>
    GET(
      new NextRequest("https://codebox.test/api/cron/account-deletions", {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("requires the cron secret as a bearer token", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call(`Bearer ${"c".repeat(40)}`)).status).toBe(200);
  });

  it("is closed when no strong secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("Bearer short")).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
