// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  onboarded: vi.fn(),
  authenticatedAt: vi.fn(),
  me: vi.fn(),
  preferences: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({
    url: "https://db.codebox.test",
    siteUrl: "https://codebox.test",
  }),
}));
vi.mock("@/lib/profiles/load", () => ({
  requireOnboardedUser: mocks.onboarded,
}));
vi.mock("@/lib/auth/recent", async (original) => ({
  ...(await original<typeof import("@/lib/auth/recent")>()),
  lastAuthenticatedAt: mocks.authenticatedAt,
}));
vi.mock("@/app/settings/actions", () => ({
  saveTheme: vi.fn(),
  saveProfile: vi.fn(),
  deleteAccount: vi.fn(),
  reauthenticate: vi.fn(),
}));
vi.mock("@/app/onboarding/actions", () => ({
  saveGenres: vi.fn(),
  saveFavoriteMovies: vi.fn(),
}));
vi.mock("@/app/profiles/actions", () => ({
  removeFollower: vi.fn(),
  respondToFollow: vi.fn(),
  setVisibility: vi.fn(),
  unblock: vi.fn(),
}));
vi.mock("@/app/auth/actions", () => ({ signInWithGoogle: vi.fn() }));
import SettingsPage from "@/app/settings/page";

/** A chainable query builder that resolves to `result` when awaited. */
function query(result: () => unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"])
    builder[method] = () => builder;
  builder.single = () => Promise.resolve(result());
  builder.maybeSingle = () => Promise.resolve(result());
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve);
  return builder;
}
const supabase = {
  from: (table: string) =>
    query(() => {
      if (table === "users") return mocks.me();
      if (table === "user_preferences") return mocks.preferences();
      return { data: [] };
    }),
  rpc: () => Promise.resolve({ data: [] }),
};
function signIn(providers: string[]) {
  mocks.onboarded.mockResolvedValue({
    user: {
      id: "u1",
      identities: providers.map((provider) => ({ provider })),
    },
    username: "film_fan",
    supabase,
  });
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    (q: string) => ({ matches: false, media: q }) as MediaQueryList,
  );
  signIn(["email"]);
  mocks.authenticatedAt.mockResolvedValue(Math.floor(Date.now() / 1000));
  mocks.me.mockReturnValue({
    data: {
      visibility: "public",
      avatar: "u1/pic.webp",
      profile: { display_name: "Ada", bio: "Hi" },
    },
  });
  mocks.preferences.mockReturnValue({
    data: { favorite_genre_ids: [18], theme: "dark" },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPage() {
  render(await SettingsPage());
}

describe("Settings page", () => {
  it("requires an onboarded user for /settings", async () => {
    await renderPage();
    expect(mocks.onboarded).toHaveBeenCalledWith("/settings");
  });

  it("links every section and shows the permanent username", async () => {
    await renderPage();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    for (const id of [
      "profile",
      "favorites",
      "privacy",
      "theme",
      "people",
      "blocked",
      "delete-account",
    ]) {
      expect(nav.querySelector(`a[href="#${id}"]`)).toBeTruthy();
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(document.body.textContent).toContain(
      "Your username, @film_fan, is permanent.",
    );
  });

  it("prefills profile, avatar, genres and the account theme", async () => {
    await renderPage();
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("Ada");
    expect((screen.getByLabelText("Bio") as HTMLTextAreaElement).value).toBe(
      "Hi",
    );
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "https://db.codebox.test/storage/v1/object/public/avatars/u1/pic.webp",
    );
    expect(
      (
        document.querySelector(
          'input[name="genre"][value="18"]',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Save genres" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save favorites" })).toBeTruthy();
    expect(screen.queryByText("Skip for now")).toBeNull();
    expect((screen.getByLabelText(/^Dark/) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("never offers a star, bucket or ranking control", async () => {
    await renderPage();
    expect(document.body.textContent).not.toMatch(/\bstars?\b|bucket|\brank/i);
  });

  it("falls back to this browser's theme when the stored value is invalid", async () => {
    localStorage.setItem("codebox-theme", "light");
    mocks.preferences.mockReturnValue({ data: { theme: "neon" } });
    await renderPage();
    expect((screen.getByLabelText(/^Light/) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("renders with no preferences row and an empty profile", async () => {
    mocks.preferences.mockReturnValue({ data: null });
    mocks.me.mockReturnValue({ data: { avatar: null, profile: null } });
    await renderPage();
    expect(document.body.textContent).toContain("Upload avatar");
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("");
    expect((screen.getByLabelText(/^System/) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("shows the deletion form only after a recent sign-in", async () => {
    await renderPage();
    expect(screen.getByLabelText(/to confirm/)).toBeTruthy();
    cleanup();
    mocks.authenticatedAt.mockResolvedValue(
      Math.floor(Date.now() / 1000) - 3600,
    );
    await renderPage();
    expect(screen.queryByLabelText(/to confirm/)).toBeNull();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Confirm with Google" }),
    ).toBeNull();
  });

  it("offers Google only (no password) to Google-only accounts", async () => {
    signIn(["google"]);
    mocks.authenticatedAt.mockResolvedValue(null);
    await renderPage();
    expect(
      screen.getByRole("button", { name: "Confirm with Google" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("offers both to accounts with email and Google identities", async () => {
    signIn(["email", "google"]);
    mocks.authenticatedAt.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Confirm with Google" }),
    ).toBeTruthy();
  });

  it("offers a password when identities are unknown", async () => {
    signIn([]);
    mocks.authenticatedAt.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });
});
