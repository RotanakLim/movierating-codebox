import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getPublicConfig: mocks.config }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import {
  cleanUpDeletedAccount,
  processAccountDeletions,
} from "@/lib/supabase/account-cleanup";
import { GET } from "@/app/api/cron/account-deletions/route";

const A = "00000000-0000-0000-0000-00000000000a";
const SECRET = "c".repeat(40);
const recorded = () =>
  mocks.rpc.mock.calls.filter(
    ([name]) => name === "record_account_deletion_attempt",
  );

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("CRON_SECRET", SECRET);
  mocks.config.mockReturnValue({ url: "https://db.codebox.test" });
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

describe("cleanUpDeletedAccount edge cases", () => {
  it("does nothing when Supabase is not configured", async () => {
    mocks.config.mockReturnValue(null);
    expect(await cleanUpDeletedAccount(A)).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only service key as missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "   ");
    expect(await cleanUpDeletedAccount(A)).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("creates a session-less service client", async () => {
    await cleanUpDeletedAccount(A);
    const [url, key, options] = mocks.createClient.mock.calls[0];
    expect(url).toBe("https://db.codebox.test");
    expect(key).toBe("service-key");
    expect(options.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
  });

  it("records 'avatar removal failed' and keeps the auth user", async () => {
    mocks.list.mockResolvedValue({ data: [{ name: "a.webp" }], error: null });
    mocks.remove.mockResolvedValue({ error: { statusCode: "500" } });
    expect(await cleanUpDeletedAccount(A)).toBe(false);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(recorded()[0][1]).toEqual({
      target: A,
      failure: "avatar removal failed",
    });
  });

  it("gives up after 20 rounds when the folder never empties", async () => {
    mocks.list.mockResolvedValue({ data: [{ name: "a.webp" }], error: null });
    expect(await cleanUpDeletedAccount(A)).toBe(false);
    expect(mocks.list).toHaveBeenCalledTimes(20);
    expect(recorded()[0][1].failure).toBe("avatar folder did not empty");
  });

  it("records a generic reason for non-Error throws", async () => {
    mocks.deleteUser.mockRejectedValue("boom");
    expect(await cleanUpDeletedAccount(A)).toBe(false);
    expect(recorded()[0][1].failure).toBe("cleanup failed");
  });

  it("returns false (not throws) when recording the attempt throws", async () => {
    mocks.rpc.mockRejectedValue(new Error("network"));
    expect(await cleanUpDeletedAccount(A)).toBe(false);
  });
});

describe("processAccountDeletions edge cases", () => {
  it("passes max_rows through and handles an empty queue", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await processAccountDeletions(5)).toEqual({
      processed: 0,
      completed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("pending_account_deletions", {
      max_rows: 5,
    });
  });

  it("throws when the queue can't be read", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(processAccountDeletions()).rejects.toThrow(
      "The deletion queue is unavailable.",
    );
  });
});

describe("GET /api/cron/account-deletions edge cases", () => {
  const call = (authorization = `Bearer ${SECRET}`) =>
    GET(
      new NextRequest("https://codebox.test/api/cron/account-deletions", {
        headers: { authorization },
      }),
    );

  it("returns 503 when the queue is unavailable", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Cleanup is unavailable." });
  });

  it("returns 503 when the service key is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await call()).status).toBe(503);
  });

  it("reports counts, never cached", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "pending_account_deletions"
        ? { data: [{ user_id: A, attempts: 0 }], error: null }
        : { data: null, error: null },
    );
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ processed: 1, completed: 1 });
  });

  it("rejects a lowercase scheme or a bare secret", async () => {
    expect((await call(`bearer ${SECRET}`)).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
  });

  it("accepts a padded CRON_SECRET env value (trimmed)", async () => {
    vi.stubEnv("CRON_SECRET", `  ${SECRET}\n`);
    expect((await call()).status).toBe(200);
  });
});
