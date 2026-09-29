import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/redirect";
describe("safe auth return paths", () => {
  it.each([
    undefined,
    null,
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/%5cevil.test",
    "/%2f%2fevil.test",
    "/%0a/evil.test",
    "/auth/callback",
    "/a/../auth/sign-in",
    "/%61uth/sign-in",
    "/%ZZ",
  ])("rejects %s", (value) => expect(safeNext(value)).toBe("/account"));
  it.each(["/", "/account", "/movies/123?tab=reviews#latest"])(
    "preserves %s",
    (value) => expect(safeNext(value)).toBe(value),
  );
});
