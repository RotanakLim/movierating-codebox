// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  saveTheme: vi.fn(),
  saveProfile: vi.fn(),
  deleteAccount: vi.fn(),
  reauthenticate: vi.fn(),
  saveGenres: vi.fn(),
  saveFavoriteMovies: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));
vi.mock("@/app/settings/actions", () => ({
  saveTheme: mocks.saveTheme,
  saveProfile: mocks.saveProfile,
  deleteAccount: mocks.deleteAccount,
  reauthenticate: mocks.reauthenticate,
}));
vi.mock("@/app/onboarding/actions", () => ({
  saveGenres: mocks.saveGenres,
  saveFavoriteMovies: mocks.saveFavoriteMovies,
}));
vi.mock("@/app/auth/actions", () => ({ signInWithGoogle: vi.fn() }));
import {
  AvatarUpload,
  DeleteAccount,
  ProfileForm,
  ThemeForm,
} from "@/components/settings/forms";
import { GenreForm } from "@/components/onboarding/genre-form";
import { FavoriteMoviesForm } from "@/components/onboarding/favorite-movies-form";

const fetchMock = vi.fn();
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: false, media: query }) as MediaQueryList,
  );
  fetchMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const file = (type: string, size = 10, name = "a") =>
  new File([new Uint8Array(size)], name, { type });
async function choose(input: HTMLElement, chosen: File) {
  await act(async () =>
    fireEvent.change(input, { target: { files: [chosen] } }),
  );
}

describe("<ProfileForm>", () => {
  it("prefills, shows character counters and caps input lengths", () => {
    render(<ProfileForm displayName="Ada" bio="Hello" />);
    const name = screen.getByLabelText("Display name") as HTMLInputElement;
    const bio = screen.getByLabelText("Bio") as HTMLTextAreaElement;
    expect(name.value).toBe("Ada");
    expect(name.maxLength).toBe(60);
    expect(bio.maxLength).toBe(300);
    expect(document.body.textContent).toContain("3/60");
    fireEvent.change(bio, { target: { value: "Hello there" } });
    expect(document.body.textContent).toContain("11/300");
  });

  it("saves, confirms and refreshes", async () => {
    mocks.saveProfile.mockResolvedValue({ ok: true });
    render(<ProfileForm displayName="" bio="" />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Ada L" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save profile" })),
    );
    expect(mocks.saveProfile).toHaveBeenCalledWith({
      displayName: "Ada L",
      bio: "",
    });
    expect(screen.getByRole("status").textContent).toBe("Profile saved.");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows the server error as an alert without refreshing", async () => {
    mocks.saveProfile.mockResolvedValue({
      ok: false,
      error: "Bio can be up to 300 characters.",
    });
    render(<ProfileForm displayName="" bio="" />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save profile" })),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Bio can be up to 300 characters.",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("<AvatarUpload>", () => {
  const input = () =>
    document.getElementById("avatar-file") as HTMLInputElement;

  it("shows Upload vs Change/Remove depending on the current avatar", () => {
    const { rerender } = render(<AvatarUpload current={null} />);
    expect(document.body.textContent).toContain("Upload avatar");
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    rerender(<AvatarUpload current="https://db.test/a.webp" />);
    expect(document.body.textContent).toContain("Change avatar");
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "https://db.test/a.webp",
    );
    expect(input().accept).toBe("image/jpeg,image/png,image/webp");
  });

  it("rejects other types and files over 2 MB without uploading", async () => {
    render(<AvatarUpload current={null} />);
    await choose(input(), file("image/gif"));
    expect(screen.getByRole("alert").textContent).toBe(
      "Choose a JPEG, PNG or WebP image.",
    );
    await choose(input(), file("image/svg+xml"));
    await choose(input(), file("image/png", 2 * 1024 * 1024 + 1));
    expect(screen.getByRole("alert").textContent).toBe(
      "Images can be up to 2 MB.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts exactly 2 MB and uploads the raw file with its type", async () => {
    fetchMock.mockResolvedValue(Response.json({ avatar: "x" }));
    render(<AvatarUpload current={null} />);
    const chosen = file("image/webp", 2 * 1024 * 1024);
    await choose(input(), chosen);
    expect(fetchMock).toHaveBeenCalledWith("/api/avatar", {
      method: "POST",
      body: chosen,
      headers: { "Content-Type": "image/webp" },
    });
    expect(screen.getByRole("status").textContent).toBe("Avatar updated.");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows the server's error message, or a generic one", async () => {
    render(<AvatarUpload current={null} />);
    fetchMock.mockResolvedValue(
      Response.json({ error: "Too many avatar changes." }, { status: 429 }),
    );
    await choose(input(), file("image/png"));
    expect(screen.getByRole("alert").textContent).toBe(
      "Too many avatar changes.",
    );
    fetchMock.mockResolvedValue(new Response("<html>", { status: 502 }));
    await choose(input(), file("image/png"));
    expect(screen.getByRole("alert").textContent).toBe(
      "That didn't work. Please try again.",
    );
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await choose(input(), file("image/png"));
    expect(screen.getByRole("alert").textContent).toBe(
      "That didn't work. Please try again.",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("removes the avatar with DELETE and no body", async () => {
    fetchMock.mockResolvedValue(Response.json({ avatar: null }));
    render(<AvatarUpload current="https://db.test/a.webp" />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Remove" })),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/avatar", {
      method: "DELETE",
      body: undefined,
      headers: undefined,
    });
    expect(screen.getByRole("status").textContent).toBe("Avatar removed.");
  });

  it("disables controls while a request is in flight", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<AvatarUpload current="https://db.test/a.webp" />);
    await choose(input(), file("image/png"));
    expect(input().disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(document.body.textContent).toContain("Working…");
    await act(async () => finish(Response.json({})));
    expect(input().disabled).toBe(false);
  });
});

describe("<ThemeForm> edge cases", () => {
  it("prefers the account theme over this browser's copy", () => {
    localStorage.setItem("codebox-theme", "light");
    render(<ThemeForm account="dark" />);
    expect((screen.getByLabelText(/^Dark/) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("keeps the local change but shows an error when saving fails", async () => {
    mocks.saveTheme.mockResolvedValue({ ok: false, error: "Nope." });
    render(<ThemeForm account={null} />);
    await act(async () => fireEvent.click(screen.getByLabelText(/^Dark/)));
    expect(localStorage.getItem("codebox-theme")).toBe("dark");
    expect(screen.getByRole("alert").textContent).toBe("Nope.");
  });

  it("shows a friendly error when the action throws", async () => {
    mocks.saveTheme.mockRejectedValue(new Error("network"));
    render(<ThemeForm account={null} />);
    await act(async () => fireEvent.click(screen.getByLabelText(/^Light/)));
    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't save your theme to your account.",
    );
  });
});

describe("<DeleteAccount> edge cases", () => {
  it("accepts the username case-insensitively with surrounding spaces", () => {
    render(
      <DeleteAccount
        username="film_fan"
        recent
        hasPassword
        hasGoogle={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: "  FILM_FAN " },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Delete my account permanently",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows the reauth error and does not refresh", async () => {
    mocks.reauthenticate.mockResolvedValue({
      ok: false,
      error: "Too many attempts. Please wait and try again.",
    });
    render(
      <DeleteAccount
        username="film_fan"
        recent={false}
        hasPassword
        hasGoogle
      />,
    );
    expect(
      screen.getByRole("button", { name: "Confirm with Google" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Confirm password" })),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Too many attempts. Please wait and try again.",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  // BUG: forms.tsx calls clearAllDrafts() right after starting the transition,
  // before knowing whether deleteAccount succeeded, so a refused deletion
  // (stale sign-in, DB error) still wipes the user's unsent entry drafts.
  it("keeps entry drafts when the deletion is refused", async () => {
    sessionStorage.setItem("codebox:entry-draft:v1:u1:27205", "{}");
    mocks.deleteAccount.mockResolvedValue({
      ok: false,
      error: "Sign in again.",
    });
    render(
      <DeleteAccount
        username="film_fan"
        recent
        hasPassword
        hasGoogle={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: "film_fan" },
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Delete my account permanently" }),
      ),
    );
    expect(screen.getByRole("alert").textContent).toBe("Sign in again.");
    expect(sessionStorage.getItem("codebox:entry-draft:v1:u1:27205")).toBe(
      "{}",
    );
  });
});

describe("<GenreForm> settings mode", () => {
  it("renders a settings submit label, no skip link and a mode field", () => {
    render(<GenreForm next="/settings" selected={[18]} mode="settings" />);
    expect(screen.getByRole("button", { name: "Save genres" })).toBeTruthy();
    expect(screen.queryByText("Skip for now")).toBeNull();
    expect(
      (document.querySelector('input[name="mode"]') as HTMLInputElement).value,
    ).toBe("settings");
    expect(
      (
        document.querySelector(
          'input[name="genre"][value="18"]',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("keeps the onboarding label and skip link by default", () => {
    render(
      <GenreForm next="/" selected={[]} skipHref="/onboarding?step=movies" />,
    );
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeTruthy();
    expect(screen.getByText("Skip for now").getAttribute("href")).toBe(
      "/onboarding?step=movies",
    );
    expect(
      (document.querySelector('input[name="mode"]') as HTMLInputElement).value,
    ).toBe("onboarding");
  });

  it("shows Saved. after a settings save", async () => {
    mocks.saveGenres.mockResolvedValue({ saved: true });
    render(<GenreForm next="/settings" selected={[18]} mode="settings" />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save genres" })),
    );
    expect(mocks.saveGenres).toHaveBeenCalled();
    const data = mocks.saveGenres.mock.calls[0][1] as FormData;
    expect(data.get("mode")).toBe("settings");
    expect(data.getAll("genre")).toEqual(["18"]);
    expect(screen.getByRole("status").textContent).toBe("Saved.");
  });
});

describe("<FavoriteMoviesForm> settings mode", () => {
  const movie = { id: 27205, title: "Inception", posterPath: null, year: 2010 };
  it("renders a settings submit label and no skip link", () => {
    render(
      <FavoriteMoviesForm next="/settings" initial={[movie]} mode="settings" />,
    );
    expect(screen.getByRole("button", { name: "Save favorites" })).toBeTruthy();
    expect(screen.queryByText("Skip for now")).toBeNull();
    expect(
      (document.querySelector('input[name="movie"]') as HTMLInputElement).value,
    ).toBe("27205");
  });

  it("shows Saved. after a settings save", async () => {
    mocks.saveFavoriteMovies.mockResolvedValue({ saved: true });
    render(
      <FavoriteMoviesForm next="/settings" initial={[movie]} mode="settings" />,
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save favorites" })),
    );
    expect(
      (mocks.saveFavoriteMovies.mock.calls[0][1] as FormData).get("mode"),
    ).toBe("settings");
    expect(screen.getByText("Saved.").getAttribute("role")).toBe("status");
  });
});
