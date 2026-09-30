import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claims: vi.fn(),
  username: vi.fn(),
  configured: vi.fn(),
  theme: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getPublicConfig: mocks.configured }));
vi.mock("@/lib/onboarding/profile", () => ({ readUsername: mocks.username }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: mocks.claims },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.theme }) }),
    }),
  }),
}));
import { GET } from "@/app/api/me/route";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.configured.mockReturnValue({ siteUrl: "https://codebox.test" });
  mocks.theme.mockResolvedValue({ data: null });
});
describe("GET /api/me", () => {
  it("reports a guest without reading profiles, never cached", async () => {
    mocks.claims.mockResolvedValue({ data: null, error: null });
    const response = await GET();
    expect(await response.json()).toEqual({ signedIn: false });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.username).not.toHaveBeenCalled();
  });
  it("returns the account theme, or null when never chosen or invalid", async () => {
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });
    mocks.username.mockResolvedValue("film_fan");
    mocks.theme.mockResolvedValue({ data: { theme: "dark" } });
    expect((await (await GET()).json()).theme).toBe("dark");
    mocks.theme.mockResolvedValue({ data: { theme: null } });
    expect((await (await GET()).json()).theme).toBeNull();
    mocks.theme.mockResolvedValue({ data: { theme: "neon" } });
    expect((await (await GET()).json()).theme).toBeNull();
  });
  it("returns the username, or null before onboarding", async () => {
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });
    mocks.username.mockResolvedValue("film_fan");
    expect(await (await GET()).json()).toEqual({
      signedIn: true,
      username: "film_fan",
      theme: null,
    });
    mocks.username.mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({
      signedIn: true,
      username: null,
      theme: null,
    });
  });
  it("is inert when Supabase is not configured", async () => {
    mocks.configured.mockReturnValue(null);
    expect(await (await GET()).json()).toEqual({ signedIn: false });
    expect(mocks.claims).not.toHaveBeenCalled();
  });
});
