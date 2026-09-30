// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/discover" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/entries/actions", () => ({ deleteEntry: vi.fn() }));
vi.mock("@/app/watchlist/actions", () => ({ setWatchlisted: vi.fn() }));
vi.mock("@/app/lists/actions", () => ({
  createList: vi.fn(),
  deleteList: vi.fn(),
  setListMembership: vi.fn(),
  updateList: vi.fn(),
}));
import { AppNav } from "@/components/app-nav";
import { DiaryView } from "@/components/profiles/diary-view";
import { collectionQuery } from "@/lib/profiles/types";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  document.cookie =
    "sb-local-auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  nav.pathname = "/discover";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("collection query parsing", () => {
  it("defaults to highest rated, page 1, no filters", () => {
    expect(collectionQuery({})).toEqual({
      sort: "rating-desc",
      rated: false,
      watched: false,
      page: 1,
    });
  });
  it("accepts known sorts and filters and ignores junk", () => {
    expect(
      collectionQuery({
        sort: "latest-watch",
        rated: "1",
        watched: "1",
        page: "3",
      }),
    ).toEqual({ sort: "latest-watch", rated: true, watched: true, page: 3 });
    expect(collectionQuery({ sort: "manual", page: "-2" })).toMatchObject({
      sort: "rating-desc",
      page: 1,
    });
    expect(collectionQuery({ page: "1.5" }).page).toBe(1);
  });
});

describe("<DiaryView>", () => {
  const row = (id: string, watchedDate: string | null, title = id) => ({
    id,
    movieId: 1,
    title,
    year: 2024,
    score: 8,
    note: null,
    spoiler: false,
    watchedDate,
  });
  it("groups watches by date with Unknown date last, and hides spoiler text", () => {
    render(
      <DiaryView
        rows={[
          row("a", "2026-06-01"),
          row("b", "2026-06-01"),
          { ...row("c", "2026-01-10"), note: "The twist", spoiler: true },
          row("d", null),
        ]}
        owner={false}
        basePath="/u/x/diary"
        page={1}
        hasMore={false}
      />,
    );
    const groups = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(groups).toEqual(["Jun 1, 2026", "Jan 10, 2026", "Unknown date"]);
    expect(document.body.textContent).not.toContain("The twist");
    expect(screen.queryByText("Edit")).toBeNull();
  });
  it("gives the owner Edit and Delete with confirmation", () => {
    render(
      <DiaryView
        rows={[row("a", "2026-06-01", "Arrival")]}
        owner
        basePath="/me/diary"
        page={1}
        hasMore={false}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Edit" }).getAttribute("href"),
    ).toBe("/movies/1?edit=a");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("group").textContent).toContain(
      "Delete this entry for Arrival?",
    );
    expect(screen.getByRole("button", { name: "Delete entry" })).toBeTruthy();
  });
});

describe("<AppNav>", () => {
  it("lists the main destinations and marks the current page", () => {
    render(<AppNav />);
    const main = screen.getAllByRole("navigation", { name: "Main" }).at(-1)!;
    const labels = [...main.querySelectorAll("a")].map((a) => a.textContent);
    expect(labels).toEqual([
      "Home",
      "Discover",
      "My Movies",
      "Watchlist",
      "Sign in",
      "Settings",
    ]);
    expect(main.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Discover",
    );
    // Guests have no session cookie, so no profile request is made.
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("opens and closes the phone menu, and closes on navigation", () => {
    const { rerender } = render(<AppNav />);
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(
      screen
        .getByRole("button", { name: "Close menu" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.getElementById("mobile-nav")).toBeTruthy();
    nav.pathname = "/me/movies";
    rerender(<AppNav />);
    expect(document.getElementById("mobile-nav")).toBeNull();
  });
  it("links Profile to the signed-in user's username", async () => {
    document.cookie = "sb-local-auth-token=x";
    fetchMock.mockResolvedValue(
      Response.json({ signedIn: true, username: "film_fan" }),
    );
    await act(async () => {
      render(<AppNav />);
    });
    const main = screen.getAllByRole("navigation", { name: "Main" }).at(-1)!;
    expect(
      [...main.querySelectorAll("a")]
        .find((a) => a.textContent === "Profile")
        ?.getAttribute("href"),
    ).toBe("/u/film_fan");
  });
});
