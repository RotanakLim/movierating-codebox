import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const getUser = vi.hoisted(() => vi.fn());
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
      getUser: async () => {
        getUser();
        options.cookies.setAll([
          {
            name: "refreshed-session",
            value: "test-only",
            options: { path: "/", httpOnly: true },
          },
        ]);
        return { data: { user: null }, error: null };
      },
    },
  }),
}));
import { updateSession } from "@/lib/supabase/middleware";
it("forwards refreshed session cookies to both server render and browser with private caching", async () => {
  const request = new NextRequest("https://codebox.test/account");
  const response = await updateSession(request);
  expect(getUser).toHaveBeenCalledOnce();
  expect(request.cookies.get("refreshed-session")?.value).toBe("test-only");
  expect(response.cookies.get("refreshed-session")?.value).toBe("test-only");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
