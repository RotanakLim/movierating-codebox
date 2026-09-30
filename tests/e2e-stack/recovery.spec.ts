import { test, expect } from "@playwright/test";
import { pageAs, signIn } from "./helpers";
import { MOVIES, PASSWORD, PRIVATE_REVIEW, admin, email } from "./seed";

// Scenario 15: failures end in a state the user can recover from, and nothing
// already on screen or typed is lost.

const movie = {
  id: 1,
  title: "Recovered",
  posterPath: null,
  year: 2020,
  genreIds: [],
};

test("TMDB timeouts and rate limits show the provider's message and a retry", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/movies/search?**", (route) => {
    calls++;
    if (calls === 1)
      return route.fulfill({
        status: 429,
        headers: { "Retry-After": "30" },
        json: { error: "The movie catalog is busy. Please try again shortly." },
      });
    if (calls === 2)
      return route.fulfill({
        status: 504,
        json: { error: "Movie search took too long. Please try again." },
      });
    return route.fulfill({
      json: { movies: [movie], page: 1, hasMore: false, filteredPage: false },
    });
  });
  await page.goto("/discover?q=anything");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "The movie catalog is busy",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "took too long",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Recovered")).toBeVisible();
});

test("a proxy error page (not JSON) still gives a readable message", async ({
  page,
}) => {
  await page.route("**/api/movies/search?**", (route) =>
    route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<html>Bad gateway</html>",
    }),
  );
  await page.goto("/discover?q=anything");
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toContainText("Movie search is unavailable");
  await expect(alert).not.toContainText("JSON");
});

test("an empty search says so and suggests what to change", async ({
  page,
}) => {
  await page.route("**/api/movies/search?**", (route) =>
    route.fulfill({
      json: { movies: [], page: 1, hasMore: false, filteredPage: false },
    }),
  );
  await page.goto("/discover?q=zzzzzz");
  await expect(
    page.getByRole("heading", { name: "No movies found this time." }),
  ).toBeVisible();
});

test("missing posters fall back to a labelled placeholder", async ({
  page,
}) => {
  await page.route("https://image.tmdb.org/**", (route) => route.abort());
  await page.goto("/u/e2e_admin"); // Rashomon: the only entry, with a poster path.
  await expect(page.getByText("Poster unavailable").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /poster/ })).toHaveCount(0);
});

test("a failed next page keeps the loaded feed and can be retried", async ({
  page,
}) => {
  await signIn(page, "owner", "/?tab=community");
  const items = page.getByRole("main").getByRole("article");
  const before = await items.count();
  expect(before).toBeGreaterThan(0);
  let fail = true;
  await page.route("**/api/feed?**", (route) => {
    if (!fail) return route.continue();
    fail = false;
    return route.fulfill({
      status: 503,
      json: { error: "The feed is unavailable right now. Please try again." },
    });
  });
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "The feed is unavailable",
  );
  await expect(items).toHaveCount(before);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => items.count()).toBeGreaterThan(before);
});

test("an expired session keeps the comment draft and offers sign-in", async ({
  page,
}) => {
  await signIn(page, "fan", `/reviews/${PRIVATE_REVIEW}`);
  await page.context().clearCookies();
  const box = page.getByLabel("Post comment");
  await box.fill("Written before my session ran out.");
  await page.getByRole("button", { name: "Post comment" }).click();
  const alert = page
    .getByRole("main")
    .getByRole("alert")
    .filter({ hasText: "Sign in to continue." });
  await expect(alert).toContainText(
    "your text will be here when you come back",
  );
  await alert.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL(/\/auth\/sign-in/);
  await page.getByLabel("Email").fill(email("fan"));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(new RegExp(`/reviews/${PRIVATE_REVIEW}`));
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Post comment")).toHaveValue(
    "Written before my session ran out.",
  );
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(
    page.getByText("Written before my session ran out.").last(),
  ).toBeVisible();
  await expect(page.getByLabel("Post comment")).toHaveValue("");
});

test("a failed save keeps the entry and a retry saves it once, even when double-clicked", async ({
  page,
}) => {
  await signIn(page, "follower", `/movies/${MOVIES.paprika.tmdb_id}`);
  await page.getByRole("button", { name: "Rate or review" }).click();
  const form = page.getByRole("form", { name: /Your entry for/ });
  await form.getByRole("slider").focus();
  await page.keyboard.press("End");
  await form
    .getByLabel("Review (optional)")
    .fill("Survives a dropped connection.");
  await page.context().setOffline(true);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("Your draft is kept");
  await expect(form.getByLabel("Review (optional)")).toHaveValue(
    "Survives a dropped connection.",
  );
  await page.context().setOffline(false);
  await form.getByRole("button", { name: "Save", exact: true }).dblclick();
  await expect(
    page.getByRole("status").filter({ hasText: "Your entry was saved." }),
  ).toBeVisible();
  const { data } = await admin()
    .from("entries")
    .select("id, users!entries_user_id_fkey!inner(username)")
    .eq("movie_id", MOVIES.paprika.tmdb_id)
    .eq("users.username", "e2e_follower");
  expect(data).toHaveLength(1);
});

test("conflicting edits from two tabs are caught, not overwritten", async ({
  browser,
}) => {
  const path = `/movies/${MOVIES.heat.tmdb_id}`;
  const first = await pageAs(browser, "owner", path);
  const second = await first.context().newPage();
  await second.goto(path);
  await second.waitForLoadState("networkidle");
  for (const page of [first, second]) {
    await page
      .getByRole("button", { name: /^Edit your entry/ })
      .first()
      .click();
  }
  const firstForm = first.getByRole("form", { name: /Your entry for/ });
  await firstForm
    .getByLabel("Review (optional)")
    .fill("Edited in the first tab.");
  await firstForm.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    first.getByRole("status").filter({ hasText: "Your entry was updated." }),
  ).toBeVisible();

  const secondForm = second.getByRole("form", { name: /Your entry for/ });
  await secondForm
    .getByLabel("Review (optional)")
    .fill("Edited in the second tab.");
  await secondForm.getByRole("button", { name: "Save", exact: true }).click();
  const conflict = secondForm.getByRole("alert");
  await expect(conflict).toContainText("This entry changed somewhere else");
  await conflict.getByRole("button", { name: "Reload" }).click();
  await second.waitForLoadState("networkidle");
  await expect(second.getByRole("main")).toContainText(
    "Edited in the first tab.",
  );
  await first.context().close();
});
