import { expect, test, type Page } from "@playwright/test";
const dune = {
  id: 693134,
  title: "Dune: Part Two",
  posterPath: "/dune.jpg",
  year: 2024,
  genreIds: [878],
};
const arrival = {
  id: 329865,
  title: "Arrival",
  posterPath: null,
  year: 2016,
  genreIds: [878],
};
async function posterFixture(page: Page) {
  await page.route("**/_next/image?**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#8c5d3b"/><circle cx="200" cy="200" r="90" fill="#d6b27c"/><path d="M0 480L240 310L400 420V600H0" fill="#332d2b"/></svg>',
    }),
  );
}
test("shows posters, year, filters and sends only the selected ID", async ({
  page,
}) => {
  await posterFixture(page);
  await page.route("**/api/movies/search?**", (route) =>
    route.fulfill({
      json: {
        movies: [dune, arrival],
        page: 1,
        hasMore: false,
        filteredPage: false,
      },
    }),
  );
  await page.route("**/api/movies/cache", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ tmdbId: 693134 });
    await route.fulfill({
      status: 401,
      json: { error: "Sign in to select a movie.", code: "SIGN_IN_REQUIRED" },
    });
  });
  await page.goto("/discover?q=Dune&year=2024");
  await expect(
    page.getByRole("img", { name: "Dune: Part Two poster" }),
  ).toBeVisible();
  await expect(page.getByText("Poster unavailable")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Release year" }),
  ).toHaveValue("2024");
  await page
    .getByRole("button", { name: "Select Dune: Part Two", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Sign in to continue" }),
  ).toHaveAttribute("href", /next=.*movies/);
  await page.getByRole("combobox", { name: "Genre" }).selectOption("878");
  await expect(page).toHaveURL(/genre=878/);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("deduplicates pagination and preserves results after load-more failure", async ({
  page,
}) => {
  let retry = false;
  await posterFixture(page);
  await page.route("**/api/movies/search?**", (route) => {
    if (new URL(route.request().url()).searchParams.get("page") === "1")
      return route.fulfill({
        json: { movies: [dune], page: 1, hasMore: true, filteredPage: false },
      });
    if (!retry) {
      retry = true;
      return route.fulfill({
        status: 503,
        json: { error: "Please retry this page." },
      });
    }
    return route.fulfill({
      json: {
        movies: [dune, arrival],
        page: 2,
        hasMore: false,
        filteredPage: false,
      },
    });
  });
  await page.goto("/discover");
  await page.getByRole("button", { name: "Load more movies" }).click();
  await expect(
    page.getByRole("heading", { name: dune.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry loading more" }).click();
  await expect(
    page.getByRole("heading", { name: dune.title, exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Arrival", exact: true }),
  ).toBeVisible();
});
test("does not mistake empty filtered pages for exhausted results", async ({
  page,
}) => {
  await page.route("**/api/movies/search?**", (route) =>
    route.fulfill({
      json: { movies: [], page: 1, hasMore: true, filteredPage: true },
    }),
  );
  await page.goto("/discover?q=Dune&genre=35");
  await expect(
    page.getByRole("heading", { name: "No matches on these pages yet." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load more movies" }),
  ).toBeVisible();
});
test("recovers from initial search failure", async ({ page }) => {
  let failed = false;
  await page.route("**/api/movies/search?**", (route) => {
    if (!failed) {
      failed = true;
      return route.fulfill({
        status: 503,
        json: { error: "Try again shortly." },
      });
    }
    return route.fulfill({
      json: { movies: [arrival], page: 1, hasMore: false, filteredPage: false },
    });
  });
  await page.goto("/discover");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arrival" })).toBeVisible();
});
test("debounces typing and never displays a stale search response", async ({
  page,
}) => {
  const queries: string[] = [];
  await page.route("**/api/movies/search?**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    queries.push(q);
    if (q === "Dune") await new Promise((resolve) => setTimeout(resolve, 900));
    await route
      .fulfill({
        json: {
          movies: q === "Dune" ? [dune] : q === "Arrival" ? [arrival] : [],
          page: 1,
          hasMore: false,
          filteredPage: false,
        },
      })
      .catch(() => {});
  });
  await page.goto("/discover");
  await page.getByRole("searchbox", { name: "Search movies" }).fill("Dune");
  await expect.poll(() => queries.includes("Dune")).toBe(true);
  await page.getByRole("searchbox", { name: "Search movies" }).fill("Arrival");
  await expect(
    page.getByRole("heading", { name: "Arrival", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(
    page.getByRole("heading", { name: dune.title, exact: true }),
  ).toHaveCount(0);
});
test("selection retries after failure and suppresses double submission", async ({
  page,
}) => {
  await page.route("**/api/movies/search?**", (route) =>
    route.fulfill({
      json: { movies: [arrival], page: 1, hasMore: false, filteredPage: false },
    }),
  );
  let posts = 0;
  await page.route("**/api/movies/cache", async (route) => {
    posts++;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 503,
      json: { error: "Selection failed. Try again." },
    });
  });
  await page.goto("/discover");
  const button = page.getByRole("button", {
    name: "Select Arrival",
    exact: true,
  });
  await button.click();
  await expect(button).toBeDisabled();
  await expect(
    page.getByText("Selection failed. Try again.", { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await button.click();
  await expect.poll(() => posts).toBe(2);
});
test("search alias preserves filters and real unconfigured endpoint is safe", async ({
  page,
  request,
}) => {
  await page.goto("/search?q=Dune&year=2024");
  await expect(page).toHaveURL(/\/discover\?q=Dune&year=2024/);
  const response = await request.get("/api/movies/search?q=Dune");
  expect(response.status()).toBe(503);
  expect(await response.text()).not.toContain("TMDB_API_READ_ACCESS_TOKEN");
});
