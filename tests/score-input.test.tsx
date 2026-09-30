// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScoreInput } from "@/components/entries/score-input";

function Harness({ initial = null }: { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <p id="score-label">Your score</p>
      <ScoreInput labelId="score-label" value={value} onChange={setValue} />
    </>
  );
}
afterEach(cleanup);
const slider = () => screen.getByRole("slider", { name: "Your score" });
const text = () => slider().getAttribute("aria-valuetext");

describe("<ScoreInput>", () => {
  it("reaches every score from 0.0 to 10.0 with the keyboard, in order", () => {
    render(<Harness />);
    expect(text()).toBe("Not rated");
    const seen: string[] = [];
    for (let press = 0; press <= 100; press++) {
      fireEvent.keyDown(slider(), { key: "ArrowRight" });
      seen.push(text()!);
    }
    const expected = Array.from(
      { length: 101 },
      (_, tenths) => `${(tenths / 10).toFixed(1)} out of 10`,
    );
    expect(seen).toEqual(expected);
    // Clamped at the top.
    fireEvent.keyDown(slider(), { key: "ArrowUp" });
    expect(text()).toBe("10.0 out of 10");
  });
  it("supports Home, End, Page Up/Down, arrows down and Delete to clear", () => {
    render(<Harness initial={5} />);
    fireEvent.keyDown(slider(), { key: "PageUp" });
    expect(text()).toBe("6.0 out of 10");
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    fireEvent.keyDown(slider(), { key: "ArrowDown" });
    expect(text()).toBe("5.8 out of 10");
    fireEvent.keyDown(slider(), { key: "PageDown" });
    expect(text()).toBe("4.8 out of 10");
    fireEvent.keyDown(slider(), { key: "End" });
    expect(text()).toBe("10.0 out of 10");
    expect(slider().getAttribute("aria-valuenow")).toBe("10");
    fireEvent.keyDown(slider(), { key: "Home" });
    expect(text()).toBe("0.0 out of 10");
    fireEvent.keyDown(slider(), { key: "Delete" });
    expect(text()).toBe("Not rated");
    expect(slider().hasAttribute("aria-valuenow")).toBe(false);
  });
  it("sets the score from a tap or click on the track", () => {
    render(<Harness />);
    const track = slider().firstElementChild as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect;
    fireEvent.pointerDown(slider(), { clientX: 295, pointerId: 1 });
    expect(text()).toBe("9.8 out of 10");
    fireEvent.pointerDown(slider(), { clientX: 10, pointerId: 1 });
    expect(text()).toBe("0.0 out of 10");
  });
  it("exposes the slider range to assistive technology", () => {
    render(<Harness initial={9.5} />);
    expect(slider().getAttribute("aria-valuemin")).toBe("0");
    expect(slider().getAttribute("aria-valuemax")).toBe("10");
    expect(text()).toBe("9.5 out of 10");
    expect(slider().tabIndex).toBe(0);
  });
});
