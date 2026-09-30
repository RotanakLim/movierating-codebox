import { test, expect, type Page } from "@playwright/test";
import { axeViolations, pageAs, signIn } from "./helpers";
import {
  MOVIES,
  MODERATED_REVIEW,
  OWNER_REVIEW,
  PASSWORD,
  admin,
  anonApi,
  apiAs,
  email,
  userId,
} from "./seed";

// SPEC section 14 acceptance scenarios against a real local Supabase. Numbers
// match the list in SPEC.md; README.md lists what is manual or covered elsewhere.

async function entriesFor(username: string, movieId: number) {
  const { data, error } = await admin()
    .from("entries")
    .select(
      "id, score, note, spoiler, watched, watched_date, user_id, users!entries_user_id_fkey!inner(username)",
    )
    .eq("movie_id", movieId)
    .eq("users.username", username);
  if (error) throw error;
  return data;
}

async function openComposer(page: Page, movieId: number) {
  await page.goto(`/movies/${movieId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Rate or review" }).click();
  return page.getByRole("form", { name: /Your entry for/ });
}

test("1. a guest drafts, signs up, resumes the draft and saves exactly once", async ({
  page,
}) => {
  const movie = MOVIES.paprika;
  const composer = await openComposer(page, movie.tmdb_id);
  await composer.getByRole("slider").focus();
  await page.keyboard.press("Home");
  for (let step = 0; step < 88; step++) await page.keyboard.press("ArrowRight");
  await composer
    .getByLabel("Review (optional)")
    .fill("Dreams leaking into the waking world.");
  await composer.getByRole("button", { name: "Sign in to save" }).click();
  await page.waitForURL(/\/auth\/sign-in/);

  // Sign up from the sign-in page; the destination rides along.
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Email address").fill(email("fresh"));
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/Check your email/)).toBeVisible();
  // Local Supabase confirms addresses automatically; hosted email delivery is
  // a manual check (scenario 16).

  await page.goto(
    `/auth/sign-in?next=${encodeURIComponent(`/movies/${movie.tmdb_id}?compose=rate`)}`,
  );
  await page.getByLabel("Email address").fill(email("fresh"));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel("Username").fill("e2e_fresh");
  await page.getByRole("button", { name: "Save username" }).click();
  // Genres and favorites are optional; "Finish" returns to the movie.
  await page.waitForURL(/step=genres/);
  await page.getByRole("link", { name: "Skip for now" }).click();
  await page.waitForURL(/step=movies/);
  await page.getByRole("link", { name: "Skip for now" }).click();
  await page.waitForURL(/step=finish/);
  await page.getByRole("link", { name: "Finish" }).click();
  await page.waitForURL(new RegExp(`/movies/${movie.tmdb_id}`));
  await page.waitForLoadState("networkidle");

  const restored = page.getByRole("form", { name: /Your entry for/ });
  await expect(
    restored.getByText(/We restored your unsaved draft/),
  ).toBeVisible();
  await expect(restored.getByLabel("Review (optional)")).toHaveValue(
    "Dreams leaking into the waking world.",
  );
  await expect(restored.getByRole("slider")).toHaveAttribute(
    "aria-valuenow",
    "8.8",
  );
  // Nothing was saved automatically.
  expect(await entriesFor("e2e_fresh", movie.tmdb_id)).toHaveLength(0);
  await restored.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Your entry was (saved|updated)/ }),
  ).toBeVisible();
  const saved = await entriesFor("e2e_fresh", movie.tmdb_id);
  expect(saved).toHaveLength(1);
  expect(Number(saved[0].score)).toBe(8.8);
  expect(saved[0].note).toBe("Dreams leaking into the waking world.");
});

test("2. every score is reachable by keyboard; invalid API scores are rejected", async ({
  page,
}) => {
  await signIn(page, "fan", `/movies/${MOVIES.alien.tmdb_id}`);
  const composer = await openComposer(page, MOVIES.alien.tmdb_id);
  expect(await axeViolations(page)).toEqual([]);
  const slider = composer.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuenow", "10");
  await page.keyboard.press("PageDown");
  await expect(slider).toHaveAttribute("aria-valuenow", "9");
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", "8.9");
  await page.keyboard.press("Home");
  for (let step = 0; step < 100; step++) {
    await expect(slider).toHaveAttribute(
      "aria-valuenow",
      String(Number((step / 10).toFixed(1))),
    );
    await page.keyboard.press("ArrowRight");
  }
  await expect(slider).toHaveAttribute("aria-valuenow", "10");
  await page.keyboard.press("ArrowLeft");
  await composer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Your entry was (saved|updated)/ }),
  ).toBeVisible();
  const [entry] = await entriesFor("e2e_fan", MOVIES.alien.tmdb_id);
  expect(Number(entry.score)).toBe(9.9);

  const api = await apiAs("fan");
  const fanId = await userId("fan");
  for (const score of [-0.1, 10.1, 5.55, 7.25]) {
    const { error } = await api.from("entries").insert({
      user_id: fanId,
      movie_id: MOVIES.heat.tmdb_id,
      score,
    });
    expect(error, `score ${score}`).not.toBeNull();
  }
  expect(await entriesFor("e2e_fan", MOVIES.heat.tmdb_id)).toHaveLength(0);
});

test("3. entry kinds persist; marking watched removes the watchlist item", async ({
  page,
}) => {
  const api = await apiAs("follower");
  const followerId = await userId("follower");
  const kinds = [
    {
      movie_id: MOVIES.arrival.tmdb_id,
      watched: true,
      score: null,
      note: null,
    },
    { movie_id: MOVIES.heat.tmdb_id, watched: false, score: 7.0, note: null },
    {
      movie_id: MOVIES.alien.tmdb_id,
      watched: false,
      score: null,
      note: "Only words.",
    },
    {
      movie_id: MOVIES.vertigo.tmdb_id,
      watched: true,
      score: 8.2,
      note: "All of it.",
    },
  ];
  for (const kind of kinds) {
    const { error } = await api
      .from("entries")
      .insert({ user_id: followerId, ...kind, watched_date: null });
    expect(error).toBeNull();
  }
  for (const kind of kinds) {
    const [row] = await entriesFor("e2e_follower", kind.movie_id);
    expect(row.watched).toBe(kind.watched);
    expect(row.score === null ? null : Number(row.score)).toBe(kind.score);
    expect(row.note).toBe(kind.note);
  }

  // Watchlist, then log it watched: the item leaves in the same save.
  await signIn(page, "owner", `/movies/${MOVIES.paprika.tmdb_id}`);
  await page.getByRole("button", { name: /Add to watchlist/ }).click();
  await expect(
    page.getByRole("button", {
      name: /On your watchlist|Remove from watchlist/,
    }),
  ).toBeVisible();
  await page.goto("/me/watchlist");
  await expect(page.getByRole("main")).toContainText(MOVIES.paprika.title);
  const composer = await openComposer(page, MOVIES.paprika.tmdb_id);
  await expect(composer.getByLabel("I watched this")).toBeChecked();
  await composer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Your entry was (saved|updated)/ }),
  ).toBeVisible();
  await page.goto("/me/watchlist");
  await expect(page.getByRole("main")).not.toContainText(MOVIES.paprika.title);
});

test("4. one person counts once in the community score", async ({ page }) => {
  // Arrival: owner 9.1, private 7.5, fan 8.0 (follower's watched-only doesn't count).
  await page.goto(`/movies/${MOVIES.arrival.tmdb_id}`);
  await expect(page.getByRole("main")).toContainText("3 ratings");
  await expect(page.getByRole("main")).toContainText("8.2");
  // The fan logs a rewatch with a new score: still three people, newest score counts.
  const api = await apiAs("fan");
  const { error } = await api.from("entries").insert({
    user_id: await userId("fan"),
    movie_id: MOVIES.arrival.tmdb_id,
    score: 9.0,
    watched_date: null,
  });
  expect(error).toBeNull();
  await page.reload();
  await expect(page.getByRole("main")).toContainText("3 ratings");
  await expect(page.getByRole("main")).toContainText("8.5");
});

test("5. visitors sort a profile without changing the owner's collection", async ({
  page,
  browser,
}) => {
  const owner = await pageAs(browser, "owner", "/me/movies");
  const before = await owner
    .getByRole("main")
    .getByRole("link")
    .allTextContents();
  await page.goto("/u/e2e_owner?sort=rating-asc");
  const titles = page.getByRole("main").getByRole("link", { name: /E2E / });
  const order = await titles.allTextContents();
  const heat = order.findIndex((text) => text.includes("Heat"));
  const arrival = order.findIndex((text) => text.includes("Arrival"));
  expect(heat).toBeLessThan(arrival);
  await page.goto("/u/e2e_owner?sort=title");
  await owner.reload();
  expect(
    await owner.getByRole("main").getByRole("link").allTextContents(),
  ).toEqual(before);
  await owner.context().close();
});

test("6. restricted profiles and watch dates never leak (UI and direct API)", async ({
  page,
  browser,
}) => {
  const privateId = await userId("private");
  // Guest and an unrelated signed-in user see only the restriction.
  await page.goto("/u/e2e_private");
  await expect(page.getByText("This profile is private.")).toBeVisible();
  const fan = await pageAs(browser, "fan", "/u/e2e_private");
  await expect(fan.getByText("This profile is private.")).toBeVisible();
  await fan.context().close();
  for (const path of [
    `/u/e2e_private`,
    `/movies/${MOVIES.arrival.tmdb_id}`,
    `/movies/${MOVIES.alien.tmdb_id}`,
  ]) {
    const html = await (await page.request.get(path)).text();
    expect(html, path).not.toMatch(
      /2025-12-24|Dec 24, 2025|2025-11-11|Nov 11, 2025/,
    );
  }
  // Direct API: guests and unrelated users get no rows, counts or dates.
  for (const client of [anonApi(), await apiAs("fan")]) {
    const entries = await client
      .from("entries")
      .select("id")
      .eq("user_id", privateId);
    expect(entries.data ?? []).toHaveLength(0);
    const activity = await client
      .from("activity_feed")
      .select("kind")
      .eq("user_id", privateId);
    expect((activity.data ?? []).map((row) => row.kind)).toEqual(["rated"]);
    const reviews = await client
      .from("public_reviews")
      .select("*")
      .eq("user_id", privateId);
    expect(reviews.data?.[0]).not.toHaveProperty("watched_date");
  }
});

test("7. a restricted author's public review stays visible with username", async ({
  page,
}) => {
  await page.goto(`/movies/${MOVIES.arrival.tmdb_id}`);
  const reviews = page.getByRole("region", { name: "Reviews" });
  await expect(reviews).toContainText("@e2e_private");
  await expect(reviews).toContainText("Private person, public opinion.");
});

test("8. follow approval grants access at once; duplicate requests make one edge", async ({
  browser,
}) => {
  const follower = await pageAs(browser, "follower", "/u/e2e_guarded");
  await follower
    .getByRole("button", { name: "Request to follow @e2e_guarded" })
    .click();
  await expect(
    follower.getByRole("button", { name: "Cancel request @e2e_guarded" }),
  ).toBeVisible();
  await follower.reload();
  const restricted = follower.getByText(
    "Only approved followers can see this profile.",
  );
  await expect(restricted).toBeVisible();

  const owner = await pageAs(browser, "guarded", "/notifications");
  const request = owner
    .getByRole("main")
    .locator("li")
    .filter({ hasText: "@e2e_follower" })
    .first();
  await request.getByRole("button", { name: "Accept" }).click();
  await expect(request.getByRole("button", { name: "Accept" })).toHaveCount(0);

  await follower.reload();
  await expect(restricted).toHaveCount(0);
  await expect(follower.getByRole("main")).toContainText(MOVIES.alien.title);

  // Concurrent duplicate requests (blocker -> owner) create one edge.
  const api = await apiAs("blocker");
  const ownerId = await userId("owner");
  await Promise.all(
    Array.from({ length: 4 }, () =>
      api.rpc("request_follow", { target_id: ownerId }),
    ),
  );
  const { count } = await admin()
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("follower_id", await userId("blocker"))
    .eq("following_id", ownerId);
  expect(count).toBe(1);
  await follower.context().close();
  await owner.context().close();
});

test("9 & 12. spoiler comments stay hidden; the author gets one unread notification without the text", async ({
  browser,
}) => {
  // Start from an empty inbox (seeding made follow notifications).
  expect(
    (await (await apiAs("owner")).rpc("mark_notifications_read", {})).error,
  ).toBeNull();
  const fan = await pageAs(browser, "fan", `/reviews/${OWNER_REVIEW}`);
  await fan
    .getByLabel("Post comment")
    .fill("The heptapods see all of time at once.");
  await fan.getByLabel("Contains spoilers").first().check();
  await fan.getByRole("button", { name: "Post comment" }).click();
  await expect(fan.getByRole("button", { name: "Show comment" })).toBeVisible();
  await fan.context().close();

  const owner = await pageAs(browser, "owner", `/reviews/${OWNER_REVIEW}`);
  const main = owner.getByRole("main");
  await expect(main).not.toContainText("heptapods");
  await owner.getByRole("button", { name: "Show comment" }).click();
  await expect(main).toContainText("The heptapods see all of time at once.");

  // The owner's own comment makes no notification for themself.
  await owner.getByLabel("Post comment").fill("Thanks for reading.");
  await owner.getByRole("button", { name: "Post comment" }).click();
  await expect(main).toContainText("Thanks for reading.");

  await owner.goto("/notifications");
  await expect(
    owner
      .getByRole("link", { name: /Notifications.*1 unread notification/ })
      .first(),
  ).toBeAttached();
  const inbox = owner.getByRole("region", { name: /Activity/ });
  await expect(inbox).toContainText("@e2e_fan commented on your review");
  await expect(inbox).not.toContainText("heptapods");
  await expect(inbox).not.toContainText("Thanks for reading");
  expect(await axeViolations(owner)).toEqual([]);
  await inbox.getByRole("link", { name: /commented on your review/ }).click();
  await owner.waitForURL(new RegExp(`/reviews/${OWNER_REVIEW}`));
  await owner.goto("/notifications");
  await expect(owner.getByText("(0 unread)")).toBeVisible();
  await owner.context().close();
});

test("10. blocks reject new interactions, even by direct request; unblock restores nothing", async ({
  browser,
}) => {
  const ownerId = await userId("owner");
  const blockerId = await userId("blocker");
  const page = await pageAs(browser, "blocker", "/u/e2e_owner");
  await page
    .getByRole("button", { name: /^Block/ })
    .first()
    .click();
  const confirm = page.getByRole("group", { name: "Block @e2e_owner" });
  await expect(
    confirm.getByRole("button", { name: "Block @e2e_owner" }),
  ).toBeFocused();
  expect(await axeViolations(page)).toEqual([]);
  await confirm.getByRole("button", { name: "Block @e2e_owner" }).click();
  await page.waitForLoadState("networkidle");

  try {
    const blocker = await apiAs("blocker");
    const owner = await apiAs("owner");
    expect(
      (await blocker.rpc("request_follow", { target_id: ownerId })).error,
    ).not.toBeNull();
    expect(
      (await owner.rpc("request_follow", { target_id: blockerId })).error,
    ).not.toBeNull();
    // Refused either way: the review is out of reach (22023) or the block applies (42501).
    const comment = await blocker.rpc("add_review_comment", {
      target: OWNER_REVIEW,
      comment_text: "Sneaking in",
      is_spoiler: false,
    });
    expect(["42501", "22023"]).toContain(comment.error?.code);
    const { count } = await admin()
      .from("follows")
      .select("*", { count: "exact", head: true })
      .or(
        `and(follower_id.eq.${blockerId},following_id.eq.${ownerId}),and(follower_id.eq.${ownerId},following_id.eq.${blockerId})`,
      );
    expect(count).toBe(0);

    await blocker.from("blocks").delete().eq("blocked_id", ownerId);
    const after = await admin()
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("follower_id", blockerId)
      .eq("following_id", ownerId);
    expect(after.count).toBe(0);
  } finally {
    // Never leave the block behind for later journeys, even after a failure.
    await admin()
      .from("blocks")
      .delete()
      .eq("blocker_id", blockerId)
      .eq("blocked_id", ownerId);
  }
  await page.context().close();
});

test("11. deleting a comment keeps its replies; deleting a review removes its discussion and updates the score", async ({
  browser,
}) => {
  const [fanEntry] = await entriesFor("e2e_fan", MOVIES.vertigo.tmdb_id);
  const reviewPath = `/reviews/${fanEntry.id}`;
  const owner = await pageAs(browser, "owner", reviewPath);
  await owner.getByLabel("Post comment").fill("Top-level thought.");
  await owner.getByRole("button", { name: "Post comment" }).click();
  await expect(owner.getByText("Top-level thought.")).toBeVisible();

  const follower = await pageAs(browser, "follower", reviewPath);
  await follower.getByRole("button", { name: "Reply" }).first().click();
  await follower.getByLabel("Post reply").fill("A reply that should survive.");
  await follower.getByRole("button", { name: "Post reply" }).click();
  await expect(
    follower.getByText("A reply that should survive."),
  ).toBeVisible();
  await follower.context().close();

  await owner.reload();
  await owner.waitForLoadState("networkidle");
  const thread = owner
    .locator("li")
    .filter({ hasText: "Top-level thought." })
    .first();
  await thread.getByRole("button", { name: "Delete" }).first().click();
  await owner.getByRole("button", { name: "Delete comment" }).click();
  await expect(owner.getByText("[deleted]")).toBeVisible();
  await owner.reload();
  await expect(owner.getByText("[deleted]")).toBeVisible();
  await expect(owner.getByText("A reply that should survive.")).toBeVisible();
  await owner.context().close();

  // The author deletes the review: its discussion goes and the average updates.
  const fan = await pageAs(browser, "fan", reviewPath);
  await fan
    .getByRole("button", { name: /^Delete/ })
    .first()
    .click();
  await fan.getByRole("button", { name: /Delete (entry|review)/ }).click();
  await fan.waitForURL(new RegExp(`/movies/${MOVIES.vertigo.tmdb_id}`));
  const { count } = await admin()
    .from("review_comments")
    .select("*", { count: "exact", head: true })
    .eq("entry_id", fanEntry.id);
  expect(count).toBe(0);
  await expect(fan.getByRole("main")).not.toContainText("6.5");
  await fan.context().close();
});

test("13. reports are private; only admins see the queue, and actions are audited", async ({
  browser,
}) => {
  const fan = await pageAs(browser, "fan", `/reviews/${MODERATED_REVIEW}`);
  const safety = fan.getByRole("main");
  await safety
    .getByRole("button", { name: "Report", exact: true })
    .first()
    .click();
  await expect(fan.getByLabel("Spam")).toBeFocused();
  expect(await axeViolations(fan)).toEqual([]);
  await fan.getByLabel("Harassment").check();
  await fan.getByRole("button", { name: "Send report" }).click();
  await expect(fan.getByText(/receipt [0-9A-F]{8}/)).toBeVisible();

  // A normal user can't open the queue or read reports.
  const denied = await fan.goto("/admin/reports");
  expect(denied?.status()).toBe(404);
  const api = await apiAs("fan");
  const reports = await api.from("reports").select("*");
  expect(reports.data ?? []).toHaveLength(0);
  expect((await api.rpc("admin_reports", {})).error).not.toBeNull();
  await fan.context().close();

  const boss = await pageAs(browser, "admin", "/admin/reports");
  const card = boss
    .getByRole("main")
    .locator("li")
    .filter({ hasText: "@e2e_owner" })
    .first();
  await card.getByRole("button", { name: "Hide review" }).click();
  await card.getByLabel("Reason (required, audited)").fill("E2E: harassment");
  await card.getByRole("button", { name: "Confirm: Hide review" }).click();
  await expect(boss.getByText("Hide review: done and recorded.")).toBeVisible();
  await expect(boss.getByRole("main")).toContainText("E2E: harassment");
  await boss.context().close();

  // The hidden review leaves the movie page and its community average.
  const guest = await browser.newPage();
  await guest.goto(`/movies/${MOVIES.moderated.tmdb_id}`);
  await expect(guest.getByRole("main")).not.toContainText(
    "A review that gets reported.",
  );
  await expect(guest.getByRole("main")).not.toContainText("1 rating");
  await guest.goto(`/reviews/${MODERATED_REVIEW}`);
  await expect(guest.getByRole("main")).not.toContainText(
    "A review that gets reported.",
  );
  await guest.close();
});

test("16. secret keys never reach browser bundles", async ({ page }) => {
  // Real values, not names: the app does contain the "sb_secret_" prefix, in the
  // check that refuses a secret key used as the public one.
  const secrets = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.RATE_LIMIT_SECRET,
    process.env.CRON_SECRET,
    process.env.TMDB_API_READ_ACCESS_TOKEN,
  ].filter((value): value is string => Boolean(value && value.length > 8));
  expect(secrets.length).toBeGreaterThan(0);
  const scripts = new Set<string>();
  page.on("response", (response) => {
    if (response.url().includes("/_next/static/")) scripts.add(response.url());
  });
  for (const path of [
    "/",
    "/discover",
    `/movies/${MOVIES.arrival.tmdb_id}`,
    "/auth/sign-in",
  ])
    await page.goto(path, { waitUntil: "networkidle" });
  expect(scripts.size).toBeGreaterThan(3);
  for (const url of scripts) {
    const body = await (await page.request.get(url)).text();
    for (const secret of secrets)
      expect(body.includes(secret), `a server secret in ${url}`).toBe(false);
    expect(body).not.toMatch(/sb_secret_[A-Za-z0-9_-]{16}/);
  }
});

test("17. spoiler bodies and restricted details stay out of page metadata", async ({
  page,
}) => {
  const [heat] = await entriesFor("e2e_owner", MOVIES.heat.tmdb_id);
  await page.goto(`/reviews/${heat.id}`);
  const head = await page.locator("head").innerHTML();
  expect(head).not.toContain("McCauley");
  await expect(page.getByRole("main")).not.toContainText("McCauley");
  await page.getByRole("button", { name: "Show review" }).click();
  await expect(page.getByRole("main")).toContainText("McCauley");

  await page.goto("/u/e2e_private");
  const profileHead = await page.locator("head").innerHTML();
  expect(profileHead).not.toMatch(/Alien|Arrival|2025/);
});
