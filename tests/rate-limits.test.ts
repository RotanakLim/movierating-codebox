import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consume = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/movie-cache", () => ({ consumeMovieLimit: consume }));

const secret = "a".repeat(64);
const headers = new Headers({ "x-vercel-forwarded-for": "203.0.113.9" });

describe("limitMovieRequest", () => {
  beforeEach(() => {
    consume.mockReset();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("hashes the client identity with RATE_LIMIT_SECRET", async () => {
    vi.stubEnv("RATE_LIMIT_SECRET", secret);
    const { limitMovieRequest } = await import("@/lib/movies/limits");
    await limitMovieRequest("search", headers);
    const expected = createHmac("sha256", secret)
      .update("search:203.0.113.9")
      .digest("hex");
    expect(consume).toHaveBeenCalledWith("search", expected);
  });

  it.each([
    ["missing", ""],
    ["shorter than 32 bytes", "a".repeat(63)],
    ["reusing the service-role key", "service-role-key".padEnd(64, "x")],
  ])("refuses a secret that is %s", async (_label, value) => {
    vi.stubEnv("RATE_LIMIT_SECRET", value);
    if (value.startsWith("service-role-key"))
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", value);
    const { limitMovieRequest } = await import("@/lib/movies/limits");
    await expect(limitMovieRequest("search", headers)).rejects.toMatchObject({
      status: 503,
      code: "NOT_CONFIGURED",
    });
    expect(consume).not.toHaveBeenCalled();
  });
});
