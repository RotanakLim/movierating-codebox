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
  deleteAccount: vi.fn(),
  reauthenticate: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));
vi.mock("@/app/settings/actions", () => ({
  saveTheme: mocks.saveTheme,
  deleteAccount: mocks.deleteAccount,
  reauthenticate: mocks.reauthenticate,
  saveProfile: vi.fn(),
}));
vi.mock("@/app/auth/actions", () => ({ signInWithGoogle: vi.fn() }));
import { DeleteAccount, ThemeForm } from "@/components/settings/forms";
import { ThemeToggle } from "@/components/theme-toggle";
import { useProfile } from "@/components/profile-link";

let systemDark = false;
const fetchMock = vi.fn();
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.saveTheme.mockResolvedValue({ ok: true });
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  systemDark = false;
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: systemDark, media: query }) as MediaQueryList,
  );
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie =
    "sb-local-auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

const dark = () => document.documentElement.classList.contains("dark");

describe("<ThemeForm>", () => {
  it("applies the choice at once, remembers it locally and saves it to the account", async () => {
    render(<ThemeForm account={null} />);
    await act(async () => fireEvent.click(screen.getByLabelText(/^Dark/)));
    expect(dark()).toBe(true);
    expect(localStorage.getItem("codebox-theme")).toBe("dark");
    expect(mocks.saveTheme).toHaveBeenCalledWith({ theme: "dark" });

    systemDark = false;
    await act(async () => fireEvent.click(screen.getByLabelText(/^System/)));
    expect(localStorage.getItem("codebox-theme")).toBeNull();
    expect(dark()).toBe(false);
  });

  it("shows this browser's choice when the account has none", () => {
    localStorage.setItem("codebox-theme", "light");
    render(<ThemeForm account={null} />);
    expect((screen.getByLabelText(/^Light/) as HTMLInputElement).checked).toBe(
      true,
    );
  });
});

describe("<ThemeToggle>", () => {
  it("saves to the account only when signed in", () => {
    const { rerender } = render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(dark()).toBe(true);
    expect(localStorage.getItem("codebox-theme")).toBe("dark");
    expect(mocks.saveTheme).not.toHaveBeenCalled();
    rerender(<ThemeToggle signedIn />);
    fireEvent.click(screen.getByRole("button"));
    expect(mocks.saveTheme).toHaveBeenCalledWith({ theme: "light" });
  });
});

describe("theme sync after sign-in", () => {
  function Probe() {
    useProfile();
    return null;
  }
  it("applies the account theme in this browser", async () => {
    document.cookie = "sb-local-auth-token=x";
    fetchMock.mockResolvedValue(
      Response.json({ signedIn: true, username: "fan", theme: "dark" }),
    );
    await act(async () => render(<Probe />));
    expect(dark()).toBe(true);
    expect(localStorage.getItem("codebox-theme")).toBe("dark");
    expect(mocks.saveTheme).not.toHaveBeenCalled();
  });
  it("saves a choice made before sign-in when the account has none", async () => {
    document.cookie = "sb-local-auth-token=x";
    localStorage.setItem("codebox-theme", "light");
    fetchMock.mockResolvedValue(
      Response.json({ signedIn: true, username: "fan", theme: null }),
    );
    await act(async () => render(<Probe />));
    expect(mocks.saveTheme).toHaveBeenCalledWith({ theme: "light" });
  });
});

describe("<DeleteAccount>", () => {
  it("asks for the password again when the sign-in isn't recent", async () => {
    mocks.reauthenticate.mockResolvedValue({ ok: true });
    render(
      <DeleteAccount
        username="film_fan"
        recent={false}
        hasPassword
        hasGoogle={false}
      />,
    );
    expect(screen.queryByLabelText(/to confirm/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Confirm with Google" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret password" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Confirm password" })),
    );
    expect(mocks.reauthenticate).toHaveBeenCalledWith({
      password: "secret password",
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("offers Google for Google accounts", () => {
    render(
      <DeleteAccount
        username="film_fan"
        recent={false}
        hasPassword={false}
        hasGoogle
      />,
    );
    expect(
      screen.getByRole("button", { name: "Confirm with Google" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("explains permanence and only enables deletion once the username is typed", async () => {
    mocks.deleteAccount.mockResolvedValue({ ok: false, error: "Nope." });
    render(
      <DeleteAccount
        username="film_fan"
        recent
        hasPassword
        hasGoogle={false}
      />,
    );
    expect(document.body.textContent).toContain(
      "permanent and can't be undone",
    );
    const button = screen.getByRole("button", {
      name: "Delete my account permanently",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: "film_fa" },
    });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: "film_fan" },
    });
    expect(button.disabled).toBe(false);
    await act(async () => fireEvent.click(button));
    expect(mocks.deleteAccount).toHaveBeenCalledWith({
      confirmation: "film_fan",
    });
    expect(screen.getByRole("alert").textContent).toBe("Nope.");
  });
});
