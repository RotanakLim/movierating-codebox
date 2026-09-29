import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth })),
}));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({ siteUrl: "https://codebox.test" }),
}));
import { GET as callback } from "@/app/auth/callback/route";
import { GET as confirm } from "@/app/auth/confirm/route";
beforeEach(() => {
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ error: null });
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
  it("forces recovery to the password form", async () => {
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
