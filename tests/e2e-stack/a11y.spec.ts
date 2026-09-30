import { test, expect, type Page } from "@playwright/test";
import {
  axeViolations,
  expectNoHorizontalScroll,
  setTheme,
  signIn,
} from "./helpers";
import { MOVIES, OWNER_REVIEW } from "./seed";

// SPEC section 12 / scenario 17: WCAG 2.2 AA checks that a machine can make.
// axe covers contrast, names, landmarks and ARIA; the rest are checked below.
const guestPages = [
  "/",
  "/discover",
  "/about",
  "/auth/sign-in",
  "/auth/sign-up",
  `/movies/${MOVIES.arrival.tmdb_id}`,
  `/reviews/${OWNER_REVIEW}`,
  "/u/e2e_owner",
  "/u/e2e_private",
  "/people",
];
const memberPages = [
  "/",
  "/?tab=community",
  "/me/movies",
  "/me/diary",
  "/me/watchlist",
  "/me/lists",
  "/notifications",
  "/settings",
  `/movies/${MOVIES.arrival.tmdb_id}`,
  `/reviews/${OWNER_REVIEW}`,
];

async function scan(page: Page, path: string, theme: "light" | "dark") {
  await page.goto(path);
  await setTheme(page, theme);
  await page.waitForLoadState("networkidle");
  return axeViolations(page);
}

for (const theme of ["light", "dark"] as const) {
  test(`guest pages have no axe violations (${theme})`, async ({ page }) => {
    const found: Record<string, unknown> = {};
    for (const path of guestPages) {
      const violations = await scan(page, path, theme);
      if (violations.length) found[path] = violations;
    }
    expect(found).toEqual({});
  });

  test(`member pages have no axe violations (${theme})`, async ({ page }) => {
    await signIn(page, "owner", "/");
    const found: Record<string, unknown> = {};
    for (const path of memberPages) {
      const violations = await scan(page, path, theme);
      if (violations.length) found[path] = violations;
    }
    expect(found).toEqual({});
  });
}

test("every page has one main landmark, a banner or nav, and a skip link", async ({
  page,
}) => {
  for (const path of guestPages) {
    await page.goto(path);
    await expect(page.getByRole("main"), path).toHaveCount(1);
    await expect(
      page.getByRole("navigation", { name: "Main" }).first(),
      path,
    ).toBeAttached();
  }
  await page.goto("/about");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("focus is always visible on interactive elements", async ({ page }) => {
  await page.goto(`/movies/${MOVIES.arrival.tmdb_id}`);
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return "none";
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });
    expect(outline).not.toMatch(/^none|0px$/);
  }
});

for (const width of [360, 640]) {
  // 640 CSS px wide is what a 1280 px window shows at 200% zoom.
  test(`no horizontal scrolling at ${width}px (${width === 640 ? "200% zoom" : "phone"})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 800 },
    });
    const page = await context.newPage();
    for (const path of guestPages) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalScroll(page);
    }
    await signIn(page, "owner", "/");
    for (const path of memberPages) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalScroll(page);
    }
    await context.close();
  });
}

test("reduced motion turns off animations and transitions", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/discover");
  const durations = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "animate-spin transition-opacity";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    return [style.animationDuration, style.transitionDuration];
  });
  for (const value of durations) expect(parseFloat(value)).toBeLessThan(0.01);
  await context.close();
});

test("the phone menu opens and closes by keyboard and returns focus", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
  });
  const page = await context.newPage();
  await page.goto("/about");
  const toggle = page.getByRole("button", { name: "Open menu" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const menu = page.locator("#mobile-nav");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  await context.close();
});
