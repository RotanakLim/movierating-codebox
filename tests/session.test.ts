import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({ getClaims: vi.fn(), refresh: false }));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({
    url: "https://supabase.test",
    key: "test-only-placeholder",
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          values: {
            name: string;
            value: string;
            options: { path: string; httpOnly: boolean };
          }[],
        ) => void;
      };
    },
  ) => ({
    auth: {
      getUser: vi.fn(),
      getClaims: async () => {
        auth.getClaims();
        if (auth.refresh)
          options.cookies.setAll([
            {
              name: "refreshed-session",
              value: "test-only",
              options: { path: "/", httpOnly: true },
            },
          ]);
        return { data: null, error: null };
      },
    },
  }),
}));
import { updateSession } from "@/lib/supabase/middleware";
import { config } from "@/middleware";

beforeEach(() => {
  auth.getClaims.mockReset();
  auth.refresh = false;
});
describe("session middleware", () => {
  it("forwards refreshed cookies to the render and browser with private caching", async () => {
    auth.refresh = true;
    const request = new NextRequest("https://codebox.test/discover");
    const response = await updateSession(request);
    expect(auth.getClaims).toHaveBeenCalledOnce();
    expect(request.cookies.get("refreshed-session")?.value).toBe("test-only");
    expect(response.cookies.get("refreshed-session")?.value).toBe("test-only");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("leaves public pages cacheable when no cookies are refreshed", async () => {
    const response = await updateSession(
      new NextRequest("https://codebox.test/movies/693134"),
    );
    expect(auth.getClaims).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBeNull();
  });
  it.each(["/auth/sign-in", "/account", "/account/settings"])(
    "always marks %s private",
    async (path) => {
      const response = await updateSession(
        new NextRequest(`https://codebox.test${path}`),
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it("does not treat look-alike paths as private", async () => {
    const response = await updateSession(
      new NextRequest("https://codebox.test/accounting"),
    );
    expect(response.headers.get("cache-control")).toBeNull();
  });
  it("skips the public search API but still runs on pages and other APIs", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/api/movies/search")).toBe(false);
    expect(matcher.test("/api/movies/cache")).toBe(true);
    expect(matcher.test("/discover")).toBe(true);
    expect(matcher.test("/account")).toBe(true);
  });
});
