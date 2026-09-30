import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test("seeded owner can sign in and sees the home feed", async ({ page }) => {
  await signIn(page, "owner", "/");
  await expect(page.getByRole("main")).toBeVisible();
});
