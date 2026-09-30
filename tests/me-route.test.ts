import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claims: vi.fn(),
  username: vi.fn(),
  configured: vi.fn(),
  theme: vi.fn(),
  requests: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getPublicConfig: mocks.configured }));
vi.mock("@/lib/onboarding/profile", () => ({ readUsername: mocks.username }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: mocks.claims },
    from: (table: string) =>
      table === "follows"
        ? {
            // Pending follow requests to the viewer (a head-only count).
            select: () => ({
              eq: (_c: string, id: string) => ({
                eq: (_s: string, status: string) =>
                  Promise.resolve({ count: mocks.requests(id, status) }),
              }),
            }),
          }
        : {
            select: () => ({ eq: () => ({ maybeSingle: mocks.theme }) }),
          },
  }),
}));
import { NextRequest } from "next/server";
import { GET } from "@/app/api/me/route";

const me = (query = "") =>
  GET(new NextRequest(`https://codebox.test/api/me${query}`));

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.configured.mockReturnValue({ siteUrl: "https://codebox.test" });
  mocks.theme.mockResolvedValue({ data: null });
  mocks.requests.mockReturnValue(0);
});
describe("GET /api/me", () => {
  it("reports a guest without reading profiles, never cached", async () => {
    mocks.claims.mockResolvedValue({ data: null, error: null });
    const response = await me();
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
    expect((await (await me("?theme=1")).json()).theme).toBe("dark");
    mocks.theme.mockResolvedValue({ data: { theme: null } });
    expect((await (await me("?theme=1")).json()).theme).toBeNull();
    mocks.theme.mockResolvedValue({ data: { theme: "neon" } });
    expect((await (await me("?theme=1")).json()).theme).toBeNull();
    // Ordinary page loads skip the preferences query.
    mocks.theme.mockClear();
    expect(await (await me()).json()).toEqual({
      signedIn: true,
      username: "film_fan",
      requests: 0,
    });
    expect(mocks.theme).not.toHaveBeenCalled();
  });
  it("counts the viewer's pending follow requests for the badge", async () => {
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });
    mocks.username.mockResolvedValue("film_fan");
    mocks.requests.mockReturnValue(3);
    expect((await (await me()).json()).requests).toBe(3);
    expect(mocks.requests).toHaveBeenCalledWith("user-1", "pending");
  });
  it("returns the username, or null before onboarding", async () => {
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });
    mocks.username.mockResolvedValue("film_fan");
    expect(await (await me()).json()).toEqual({
      signedIn: true,
      username: "film_fan",
      requests: 0,
    });
    mocks.username.mockResolvedValue(null);
    expect(await (await me()).json()).toEqual({
      signedIn: true,
      username: null,
      requests: 0,
    });
  });
  it("is inert when Supabase is not configured", async () => {
    mocks.configured.mockReturnValue(null);
    expect(await (await me()).json()).toEqual({ signedIn: false });
    expect(mocks.claims).not.toHaveBeenCalled();
  });
});
