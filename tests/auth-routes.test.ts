import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
}));
// The users-row lookup behind the onboarding redirect.
const profile = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => () => ({
  select: () => ({ eq: () => ({ maybeSingle: profile }) }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth, from })),
}));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({ siteUrl: "https://codebox.test" }),
}));
import { GET as callback } from "@/app/auth/callback/route";
import { GET as confirm } from "@/app/auth/confirm/route";
beforeEach(() => {
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  profile.mockResolvedValue({ data: { username: "film_fan" }, error: null });
});
describe("OAuth callback", () => {
  it("exchanges the code and rejects an external destination", async () => {
    const response = await callback(
      new NextRequest(
        "https://spoofed.test/auth/callback?code=sample&next=//evil.test",
      ),
    );
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("sample");
    expect(response.headers.get("location")).toBe(
      "https://codebox.test/account",
    );
  });
  it("preserves a valid local destination", async () => {
    const response = await callback(
      new NextRequest(
        "https://codebox.test/auth/callback?code=sample&next=/movies/10",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://codebox.test/movies/10",
    );
  });
  it.each(["?error=access_denied", "", "?code=sample&error=access_denied"])(
    "handles a missing/canceled callback %s",
    async (query) => {
      const response = await callback(
        new NextRequest(`https://codebox.test/auth/callback${query}`),
      );
      expect(response.headers.get("location")).toBe(
        "https://codebox.test/auth/error",
      );
      expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    },
  );
  it("sends a new Google user without a username to onboarding", async () => {
    profile.mockResolvedValue({ data: { username: null }, error: null });
    const response = await callback(
      new NextRequest(
        "https://codebox.test/auth/callback?code=sample&next=/movies/10",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://codebox.test/onboarding?next=%2Fmovies%2F10",
    );
  });
  it("keeps an unsafe next out of the onboarding redirect", async () => {
    profile.mockResolvedValue({ data: null, error: null });
    const response = await callback(
      new NextRequest(
        "https://codebox.test/auth/callback?code=sample&next=//evil.test",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://codebox.test/onboarding?next=%2Faccount",
    );
  });
  it("handles failed code exchange without exposing errors", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      error: { message: "private provider detail" },
    });
    const response = await callback(
      new NextRequest("https://codebox.test/auth/callback?code=expired"),
    );
    expect(response.headers.get("location")).toBe(
      "https://codebox.test/auth/error",
    );
  });
});
describe("email confirmation", () => {
  it("verifies signup and removes the token from the destination", async () => {
    const response = await confirm(
      new NextRequest(
        "https://codebox.test/auth/confirm?type=email&token_hash=sample&next=/account",
      ),
    );
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      type: "email",
      token_hash: "sample",
    });
    expect(response.headers.get("location")).toBe(
      "https://codebox.test/account",
    );
  });
  it("sends a newly confirmed account without a username to onboarding", async () => {
    profile.mockResolvedValue({ data: { username: null }, error: null });
    const response = await confirm(
      new NextRequest(
        "https://codebox.test/auth/confirm?type=email&token_hash=sample&next=/movies/10",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://codebox.test/onboarding?next=%2Fmovies%2F10",
    );
  });
  it("forces recovery to the password form", async () => {
    profile.mockResolvedValue({ data: { username: null }, error: null });
    const response = await confirm(
      new NextRequest(
        "https://codebox.test/auth/confirm?type=recovery&token_hash=sample&next=https://evil.test",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://codebox.test/auth/update-password",
    );
  });
  it("does not verify unsupported types", async () => {
    const response = await confirm(
      new NextRequest(
        "https://codebox.test/auth/confirm?type=invite&token_hash=sample",
      ),
    );
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://codebox.test/auth/error",
    );
  });
  it("handles expired links", async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    expect(
      (
        await confirm(
          new NextRequest(
            "https://codebox.test/auth/confirm?type=email&token_hash=expired",
          ),
        )
      ).headers.get("location"),
    ).toBe("https://codebox.test/auth/error");
  });
});
