// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({ action: vi.fn(), push: vi.fn() }));
vi.mock("@/app/watchlist/actions", () => ({ setWatchlisted: mocks.action }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
import { WatchlistToggle } from "@/components/movies/watchlist-toggle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  mocks.action.mockReset();
  mocks.push.mockReset();
});
afterEach(cleanup);

describe("<WatchlistToggle>", () => {
  it("flips immediately and keeps the new state when the server agrees", async () => {
    const reply = deferred<unknown>();
    mocks.action.mockReturnValue(reply.promise);
    render(<WatchlistToggle movieId={10} initial={false} viewer="ready" />);
    const toggle = screen.getByRole("button", { name: "Add to watchlist" });
    fireEvent.click(toggle);
    // Optimistic: updated before the server responds.
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.textContent).toContain("On your watchlist");
    expect(mocks.action).toHaveBeenCalledWith({
      movieId: 10,
      watchlisted: true,
    });
    await act(async () => reply.resolve({ ok: true, watchlisted: true }));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });
  it("rolls back and explains when the server refuses", async () => {
    mocks.action.mockResolvedValue({
      ok: false,
      code: "UNAVAILABLE",
      error: "We couldn't update your watchlist. Please try again.",
    });
    render(<WatchlistToggle movieId={10} initial={true} viewer="ready" />);
    const toggle = screen.getByRole("button", { name: "On your watchlist" });
    await act(async () => fireEvent.click(toggle));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("couldn't update");
  });
  it("rolls back when the request fails outright", async () => {
    mocks.action.mockRejectedValue(new Error("offline"));
    render(<WatchlistToggle movieId={10} initial={false} viewer="ready" />);
    const toggle = screen.getByRole("button", { name: "Add to watchlist" });
    await act(async () => fireEvent.click(toggle));
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("alert").textContent).toContain("couldn't reach");
  });
  it("sends guests to sign-in with a safe return path", () => {
    render(<WatchlistToggle movieId={10} initial={false} viewer="guest" />);
    fireEvent.click(screen.getByRole("button", { name: "Add to watchlist" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/auth/sign-in?next=%2Fmovies%2F10",
    );
    expect(mocks.action).not.toHaveBeenCalled();
  });
});
