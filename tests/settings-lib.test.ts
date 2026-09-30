import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getPublicConfig: mocks.config }));
import {
  REAUTH_WINDOW_SECONDS,
  isRecent,
  lastAuthenticatedAt,
} from "@/lib/auth/recent";
import { avatarUrl } from "@/lib/profiles/avatar-url";
import { savePreferences } from "@/lib/settings/preferences";
import {
  THEME_CHANGED,
  THEME_KEY,
  applyTheme,
  isTheme,
  storedTheme,
} from "@/lib/settings/theme";
import type { SupabaseClient } from "@supabase/supabase-js";

const claims = (result: unknown) =>
  ({
    auth: { getClaims: vi.fn().mockResolvedValue(result) },
  }) as unknown as SupabaseClient;

describe("lastAuthenticatedAt", () => {
  it("returns the newest amr timestamp", async () => {
    expect(
      await lastAuthenticatedAt(
        claims({
          data: {
            claims: {
              amr: [
                { method: "password", timestamp: 100 },
                { method: "oauth", timestamp: 300 },
                { method: "otp", timestamp: 200 },
              ],
            },
          },
          error: null,
        }),
      ),
    ).toBe(300);
  });

  it("ignores string and malformed amr entries", async () => {
    expect(
      await lastAuthenticatedAt(
        claims({
          data: {
            claims: {
              amr: [
                "password",
                { method: "x", timestamp: "999" },
                { method: "otp", timestamp: 42 },
              ],
            },
          },
          error: null,
        }),
      ),
    ).toBe(42);
  });

  // BUG: typeof null === "object", so a null amr entry throws a TypeError
  // instead of being skipped. Remove `.fails` once recent.ts guards `entry &&`.
  it("skips null amr entries instead of throwing", async () => {
    expect(
      await lastAuthenticatedAt(
        claims({
          data: { claims: { amr: [null, { method: "otp", timestamp: 7 }] } },
          error: null,
        }),
      ),
    ).toBe(7);
  });

  it("returns null without amr, on error, or without data", async () => {
    expect(
      await lastAuthenticatedAt(claims({ data: { claims: {} }, error: null })),
    ).toBeNull();
    expect(
      await lastAuthenticatedAt(
        claims({ data: { claims: { amr: [] } }, error: null }),
      ),
    ).toBeNull();
    expect(
      await lastAuthenticatedAt(
        claims({
          data: { claims: { amr: [{ timestamp: 1 }] } },
          error: new Error("bad jwt"),
        }),
      ),
    ).toBeNull();
    expect(
      await lastAuthenticatedAt(claims({ data: null, error: null })),
    ).toBeNull();
  });
});

describe("isRecent", () => {
  const now = 1_700_000_000_000;
  const nowSeconds = now / 1000;
  it("accepts sign-ins up to exactly ten minutes old", () => {
    expect(REAUTH_WINDOW_SECONDS).toBe(600);
    expect(isRecent(nowSeconds, now)).toBe(true);
    expect(isRecent(nowSeconds - 600, now)).toBe(true);
    expect(isRecent(nowSeconds - 601, now)).toBe(false);
  });
  it("rejects null (unknown sign-in time)", () => {
    expect(isRecent(null, now)).toBe(false);
  });
  it("treats a future timestamp (clock skew) as recent", () => {
    expect(isRecent(nowSeconds + 60, now)).toBe(true);
  });
  it("defaults to the current time", () => {
    expect(isRecent(Math.floor(Date.now() / 1000) - 5)).toBe(true);
    expect(isRecent(Math.floor(Date.now() / 1000) - 3600)).toBe(false);
  });
});

describe("avatarUrl", () => {
  beforeEach(() =>
    mocks.config.mockReturnValue({
      url: "https://db.codebox.test",
      siteUrl: "https://codebox.test",
    }),
  );
  it("builds the public storage URL", () => {
    expect(avatarUrl("u1/a.webp")).toBe(
      "https://db.codebox.test/storage/v1/object/public/avatars/u1/a.webp",
    );
  });
  it("encodes each segment but keeps the folder separator", () => {
    expect(avatarUrl("u 1/a#b?c%.webp")).toBe(
      "https://db.codebox.test/storage/v1/object/public/avatars/u%201/a%23b%3Fc%25.webp",
    );
  });
  it("returns null for missing paths or missing config", () => {
    expect(avatarUrl(null)).toBeNull();
    expect(avatarUrl(undefined)).toBeNull();
    expect(avatarUrl("")).toBeNull();
    mocks.config.mockReturnValue(null);
    expect(avatarUrl("u1/a.webp")).toBeNull();
  });
});

type Result = { data?: unknown; error: unknown };
function preferencesClient(steps: { update: Result[]; insert?: Result }) {
  const calls: { op: string; values: unknown; id?: string }[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe("user_preferences");
      return {
        update: (values: unknown) => ({
          eq: (_column: string, id: string) => ({
            select: () => {
              calls.push({ op: "update", values, id });
              return Promise.resolve(steps.update.shift());
            },
          }),
        }),
        insert: (values: unknown) => {
          calls.push({ op: "insert", values });
          return Promise.resolve(steps.insert);
        },
      };
    },
  };
  return { client: client as never, calls };
}

describe("savePreferences", () => {
  it("updates an existing row without inserting", async () => {
    const { client, calls } = preferencesClient({
      update: [{ data: [{ user_id: "u1" }], error: null }],
    });
    expect(await savePreferences(client, "u1", { theme: "dark" })).toBe(true);
    expect(calls).toEqual([
      { op: "update", values: { theme: "dark" }, id: "u1" },
    ]);
  });

  it("inserts with the session user id when no row exists", async () => {
    const { client, calls } = preferencesClient({
      update: [{ data: [], error: null }],
      insert: { error: null },
    });
    expect(
      await savePreferences(client, "u1", { favorite_genre_ids: [18] }),
    ).toBe(true);
    expect(calls[1]).toEqual({
      op: "insert",
      values: { user_id: "u1", favorite_genre_ids: [18] },
    });
  });

  it("fails when the first update errors, without inserting", async () => {
    const { client, calls } = preferencesClient({
      update: [{ data: null, error: { code: "42501" } }],
    });
    expect(await savePreferences(client, "u1", { theme: "light" })).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("retries the update once after a concurrent insert (23505)", async () => {
    const { client, calls } = preferencesClient({
      update: [
        { data: [], error: null },
        { data: [{ user_id: "u1" }], error: null },
      ],
      insert: { error: { code: "23505" } },
    });
    expect(await savePreferences(client, "u1", { theme: "dark" })).toBe(true);
    expect(calls.map((call) => call.op)).toEqual([
      "update",
      "insert",
      "update",
    ]);
  });

  it("fails when the retry update errors", async () => {
    const { client } = preferencesClient({
      update: [
        { data: [], error: null },
        { data: null, error: { code: "57014" } },
      ],
      insert: { error: { code: "23505" } },
    });
    expect(await savePreferences(client, "u1", { theme: "dark" })).toBe(false);
  });

  it("fails on other insert errors without retrying", async () => {
    const { client, calls } = preferencesClient({
      update: [{ data: [], error: null }],
      insert: { error: { code: "23514" } },
    });
    expect(await savePreferences(client, "u1", { theme: "dark" })).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe("theme helpers", () => {
  const store = new Map<string, string>();
  const classes = new Set<string>();
  const events: CustomEvent[] = [];
  let dark = false;
  beforeEach(() => {
    store.clear();
    classes.clear();
    dark = false;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal("matchMedia", () => ({ matches: dark }));
    events.length = 0;
    vi.stubGlobal("window", {
      dispatchEvent: (event: CustomEvent) => events.push(event),
    });
    vi.stubGlobal("document", {
      documentElement: {
        classList: {
          toggle: (name: string, on: boolean) =>
            on ? classes.add(name) : classes.delete(name),
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("isTheme accepts only the three themes", () => {
    expect(["system", "light", "dark"].every(isTheme)).toBe(true);
    for (const value of ["neon", "", null, undefined, 1, "Dark"])
      expect(isTheme(value)).toBe(false);
  });

  it("storedTheme ignores unknown values and storage errors", () => {
    expect(storedTheme()).toBe("system");
    store.set(THEME_KEY, "neon");
    expect(storedTheme()).toBe("system");
    store.set(THEME_KEY, "dark");
    expect(storedTheme()).toBe("dark");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(storedTheme()).toBe("system");
  });

  it("applyTheme follows the OS for system and survives storage errors", () => {
    dark = true;
    applyTheme("system");
    expect(classes.has("dark")).toBe(true);
    applyTheme("light");
    expect(classes.has("dark")).toBe(false);
    expect(store.get(THEME_KEY)).toBe("light");
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    });
    expect(() => applyTheme("dark")).not.toThrow();
    expect(classes.has("dark")).toBe(true);
    // Other controls (e.g. the settings radios) hear about every change.
    expect(events.map((event) => [event.type, event.detail])).toEqual([
      [THEME_CHANGED, "system"],
      [THEME_CHANGED, "light"],
      [THEME_CHANGED, "dark"],
    ]);
  });
});
