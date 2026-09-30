// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const actions = vi.hoisted(() => ({
  block: vi.fn(),
  unblock: vi.fn(),
  reportReview: vi.fn(),
  reportUser: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: actions.refresh, push: vi.fn() }),
}));
vi.mock("@/app/profiles/actions", () => ({
  block: actions.block,
  unblock: actions.unblock,
  reportReview: actions.reportReview,
  reportUser: actions.reportUser,
}));
import { ReviewList } from "@/components/reviews/review-list";
import type { Review } from "@/lib/reviews/types";

const review = (n: number, extra: Partial<Review> = {}): Review => ({
  id: `review-${n}`,
  author: { id: `user-${n}`, username: `author${n}`, avatar: null },
  score: 7.5,
  note: `Plain review ${n}`,
  spoiler: false,
  createdAt: "2026-09-30T01:00:00+00:00",
  edited: false,
  ...extra,
});
const fetchMock = vi.fn();
beforeEach(() => {
  Object.values(actions).forEach((mock) => mock.mockReset());
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<ReviewList>", () => {
  it("keeps spoiler text out of the page until revealed, but shows the score", () => {
    render(
      <ReviewList
        movieId={10}
        initial={{
          reviews: [review(1, { spoiler: true, note: "The twist is X" })],
          nextCursor: null,
        }}
      />,
    );
    expect(document.body.textContent).not.toContain("The twist is X");
    expect(document.body.textContent).toContain("7.5");
    fireEvent.click(screen.getByRole("button", { name: "Show review" }));
    expect(screen.getByText("The twist is X")).toBeTruthy();
  });
  it("keeps line breaks and marks edited reviews", () => {
    render(
      <ReviewList
        movieId={10}
        initial={{
          reviews: [review(1, { note: "Line one\nLine two", edited: true })],
          nextCursor: null,
        }}
      />,
    );
    expect(screen.getByText(/Line one/).className).toContain(
      "whitespace-pre-line",
    );
    expect(document.body.textContent).toContain("edited");
  });
  it("loads the next page with the cursor and appends without duplicates", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ reviews: [review(2), review(3)], nextCursor: null }),
    );
    render(
      <ReviewList
        movieId={10}
        initial={{ reviews: [review(1), review(2)], nextCursor: "abc" }}
      />,
    );
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Load more reviews" }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/movies/10/reviews?cursor=abc",
      expect.anything(),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Load more reviews" }),
    ).toBeNull();
  });
  it("switches to written reviews only, starting from the first page", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ reviews: [review(9)], nextCursor: null }),
    );
    render(
      <ReviewList
        movieId={10}
        initial={{ reviews: [review(1, { note: null })], nextCursor: "abc" }}
      />,
    );
    await act(async () =>
      fireEvent.click(screen.getByLabelText("Written reviews only")),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/movies/10/reviews?written=1",
      expect.anything(),
    );
    expect(screen.getByText("Plain review 9")).toBeTruthy();
  });
  it("says so when there are no reviews", () => {
    render(
      <ReviewList movieId={10} initial={{ reviews: [], nextCursor: null }} />,
    );
    expect(document.body.textContent).toContain("No reviews yet");
  });

  it("offers report and block only to signed-in viewers, never on their own review", () => {
    const initial = { reviews: [review(1), review(2)], nextCursor: null };
    const { unmount } = render(<ReviewList movieId={10} initial={initial} />);
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    unmount();
    render(<ReviewList movieId={10} initial={initial} viewerId="user-1" />);
    expect(screen.getAllByRole("button", { name: "Report" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Block @author2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Block @author1" })).toBeNull();
  });
  it("explains logged-out visibility before blocking, then hides the author with an undo", async () => {
    actions.block.mockResolvedValue({ ok: true });
    actions.unblock.mockResolvedValue({ ok: true });
    render(
      <ReviewList
        movieId={10}
        initial={{
          reviews: [
            review(2),
            review(3),
            { ...review(4), author: review(2).author },
          ],
          nextCursor: null,
        }}
        viewerId="user-1"
      />,
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Block @author2" })[0],
    );
    const confirm = screen.getByRole("group", { name: "Block @author2" });
    expect(confirm.textContent).toContain(
      "visible to anyone who is signed out",
    );
    expect(confirm.textContent).toContain("won't restore follows");
    await act(async () =>
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Block @author2" }),
      ),
    );
    expect(actions.block).toHaveBeenCalledWith({ userId: "user-2" });
    expect(document.body.textContent).not.toContain("Plain review 2");
    expect(document.body.textContent).not.toContain("Plain review 4");
    expect(document.body.textContent).toContain("Plain review 3");
    expect(screen.getByRole("status").textContent).toContain(
      "You blocked @author2",
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Unblock" })),
    );
    expect(actions.unblock).toHaveBeenCalledWith({ userId: "user-2" });
    expect(document.body.textContent).toContain("Plain review 2");
  });
  it("reports a review with a reason and shows the receipt", async () => {
    actions.reportReview.mockResolvedValue({ ok: true, receipt: "AB12CD34" });
    render(
      <ReviewList
        movieId={10}
        initial={{ reviews: [review(2)], nextCursor: null }}
        viewerId="user-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.click(screen.getByLabelText("Unmarked spoilers"));
    fireEvent.change(screen.getByLabelText("Details (optional)"), {
      target: { value: "Reveals the ending" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Send report" })),
    );
    expect(actions.reportReview).toHaveBeenCalledWith({
      reviewId: "review-2",
      reason: "spoilers",
      details: "Reveals the ending",
    });
    expect(screen.getByRole("status").textContent).toContain("AB12CD34");
  });
  it("keeps the report open with the reason when it's refused", async () => {
    actions.reportReview.mockResolvedValue({
      ok: false,
      error: "You've sent a lot of reports today. Try again in about 2 hours.",
    });
    render(
      <ReviewList
        movieId={10}
        initial={{ reviews: [review(2)], nextCursor: null }}
        viewerId="user-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.change(screen.getByLabelText("Details (optional)"), {
      target: { value: "Keep this text" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Send report" })),
    );
    expect(screen.getByRole("alert").textContent).toContain("about 2 hours");
    expect(
      (screen.getByLabelText("Details (optional)") as HTMLTextAreaElement)
        .value,
    ).toBe("Keep this text");
  });
});
