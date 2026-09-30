import { test, expect, type Page } from "@playwright/test";
import { MOVIES, OWNER_REVIEW } from "./seed";

// SPEC section 12 targets on warm (cached) pages: LCP < 2.5 s, CLS < 0.1.
// Local production build, desktop viewport, no network throttling: a regression
// check, not a field measurement. Posters come from a local fixture.
const pages = [
  "/",
  "/about",
  "/discover?q=arrival",
  `/movies/${MOVIES.arrival.tmdb_id}`,
  `/reviews/${OWNER_REVIEW}`,
  "/u/e2e_owner",
];

async function vitals(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  // Give late layout shifts a moment, then read the buffered entries.
  await page.waitForTimeout(500);
  return page.evaluate(
    () =>
      new Promise<{ lcp: number; cls: number }>((resolve) => {
        let lcp = 0;
        let cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[])
            if (!entry.hadRecentInput) cls += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve({ lcp, cls }), 100);
      }),
  );
}

test("cached pages meet LCP < 2.5 s and CLS < 0.1", async ({ page }) => {
  await page.route("https://image.tmdb.org/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#8c5d3b"/></svg>',
    }),
  );
  await page.route("**/api/movies/search?**", (route) =>
    route.fulfill({
      json: {
        movies: Array.from({ length: 20 }, (_, index) => ({
          id: 100 + index,
          title: `Result ${index}`,
          posterPath: "/poster.jpg",
          year: 2000 + index,
          genreIds: [],
        })),
        page: 1,
        hasMore: true,
        filteredPage: false,
      },
    }),
  );
  const results: Record<string, { lcp: number; cls: number }> = {};
  for (const path of pages) {
    await page.goto(path, { waitUntil: "networkidle" }); // Warm the caches.
    results[path] = await vitals(page, path);
  }
  test.info().annotations.push({
    type: "web-vitals",
    description: JSON.stringify(results),
  });
  console.log("web vitals (ms, score):", JSON.stringify(results));
  for (const [path, { lcp, cls }] of Object.entries(results)) {
    expect(lcp, `${path} LCP`).toBeLessThan(2500);
    expect(cls, `${path} CLS`).toBeLessThan(0.1);
  }
});
