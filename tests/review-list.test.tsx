// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ReviewList } from "@/components/reviews/review-list";
import type { Review } from "@/lib/reviews/types";

const review = (n: number, extra: Partial<Review> = {}): Review => ({
  id: `review-${n}`,
  author: { username: `author${n}`, avatar: null },
  score: 7.5,
  note: `Plain review ${n}`,
  spoiler: false,
  createdAt: "2026-09-30T01:00:00+00:00",
  edited: false,
  ...extra,
});
const fetchMock = vi.fn();
beforeEach(() => {
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
    expect(fetchMock).toHaveBeenCalledWith("/api/movies/10/reviews?cursor=abc");
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
    expect(fetchMock).toHaveBeenCalledWith("/api/movies/10/reviews?written=1");
    expect(screen.getByText("Plain review 9")).toBeTruthy();
  });
  it("says so when there are no reviews", () => {
    render(
      <ReviewList movieId={10} initial={{ reviews: [], nextCursor: null }} />,
    );
    expect(document.body.textContent).toContain("No reviews yet");
  });
});
