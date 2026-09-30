import AxeBuilder from "@axe-core/playwright";
import { expect, type Browser, type Page } from "@playwright/test";
import { PASSWORD, email, type UserKey } from "./seed";

/** Sign in through the real form and land on `next`. */
export async function signIn(page: Page, key: UserKey, next = "/") {
  await page.goto(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email(key));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === next.split("?")[0]);
  await page.waitForLoadState("networkidle");
}

/** A fresh browser context signed in as `key`. */
export async function pageAs(browser: Browser, key: UserKey, next = "/") {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, key, next);
  return page;
}

/** WCAG 2.2 A/AA rules from axe; returns the violations for a readable diff. */
export async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
  }));
}

export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    localStorage.setItem("codebox-theme", value);
    document.documentElement.classList.toggle("dark", value === "dark");
  }, theme);
}

/** True when the page scrolls sideways (a WCAG reflow failure). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "horizontal overflow in CSS px").toBeLessThanOrEqual(0);
}
