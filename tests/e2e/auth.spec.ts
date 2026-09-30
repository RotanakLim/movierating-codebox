import { expect, test } from "@playwright/test";
test("landing page and auth navigation", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Some movies/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Find your seat" }).click();
  await expect(
    page.getByRole("heading", { name: "Make room for favorites." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("setup is in progress");
});
test("guests cannot access protected pages", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=/);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.goto("/auth/update-password");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await page.goto("/onboarding?step=movies&next=/discover");
  await expect(page).toHaveURL(
    /\/auth\/sign-in\?next=%2Fonboarding%3Fnext%3D%252Fdiscover/,
  );
});
test("theme persists and mobile layout fits", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Toggle light and dark theme" })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/auth/sign-in");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("auth callbacks fail safely without configured credentials", async ({
  request,
}) => {
  const response = await request.get(
    "/auth/callback?code=sample&next=https://evil.test",
  );
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({
    error: "Authentication is not configured.",
  });
});
