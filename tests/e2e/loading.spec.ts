import { expect, test, type Page } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { signInAs } from "./helpers";

/* Holds matching requests back for a moment, so the busy state can be seen before the answer. */
async function slowDown(page: Page, match: (url: URL, headers: Record<string, string>) => boolean) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (match(new URL(request.url()), request.headers())) await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
}

test.describe("loading states for clicks and actions", () => {
  test("an action button turns busy with a spinner until the server answers", async ({ page }) => {
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/due");
    await slowDown(page, (_url, headers) => headers["next-action"] !== undefined);
    const run = page.getByRole("button", { name: "Run the daily job now" });
    await run.click();
    const busy = page.locator('button[aria-busy="true"]', { hasText: "Running" });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();
    await expect(page.getByRole("button", { name: "Run the daily job now" })).toBeEnabled({ timeout: 15000 });
  });

  test("a search form's button turns busy while the results load", async ({ page }) => {
    await signInAs(page, fixtureUser("cashier"));
    await page.goto("/payments/new");
    await slowDown(page, (url) => url.pathname === "/payments/new" && url.searchParams.has("q"));
    await page.getByLabel("Find loan or customer").fill("zz");
    const search = page.getByRole("button", { name: "Search" });
    // click() waits for the next page, so the busy state is recorded in the page as it happens.
    const turnedBusy = search.evaluate(
      (button) =>
        new Promise<boolean>((resolve) => {
          new MutationObserver(() => {
            if (button.getAttribute("aria-busy") === "true") resolve(button.hasAttribute("aria-busy"));
          }).observe(button, { attributes: true });
        }),
    );
    await search.click();
    expect(await turnedBusy).toBe(true);
    await expect(page.getByText("No open loan matches.")).toBeVisible({ timeout: 15000 });
  });

  test("a menu item shows a spinner while its page loads", async ({ page, isMobile }) => {
    await signInAs(page, fixtureUser("cashier"));
    await slowDown(page, (url) => url.pathname === "/customers");
    const menu = isMobile
      ? page.getByRole("navigation", { name: "Main" })
      : page.getByRole("complementary").getByRole("navigation");
    const item = menu.getByRole("link", { name: "Customers" });
    await item.click();
    await expect(item.getByTestId("spinner")).toBeVisible();
    await expect(page).toHaveURL(/\/customers$/, { timeout: 15000 });
    await expect(item.getByTestId("spinner")).toHaveCount(0);
  });
});
