import { expect, type Locator, type Page, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { signIn } from "./helpers";

/*
 * SPEC 11 Branding: the logo shows on the sign-in page and in the app shell. When the uploaded
 * logo (Storage, settings.company.logo_path) is missing, the logo shipped with the app is shown
 * instead of a broken image.
 */
const LOGO = "Method Solutions Inc. logo";
const STORAGE_LOGO = "**/storage/v1/object/public/branding/**";

async function expectLoaded(logo: Locator, src: RegExp): Promise<void> {
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", src);
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
}

function shellLogo(page: Page, isMobile: boolean): Locator {
  const area = isMobile ? page.locator("header") : page.getByRole("complementary");
  return area.getByRole("img", { name: LOGO });
}

test.describe("logo (SPEC 11 Branding)", () => {
  test("uploaded logo shows on sign-in and in the shell", async ({ page, isMobile }) => {
    await page.goto("/login");
    await expectLoaded(page.getByRole("img", { name: LOGO }), /branding\//);
    const user = fixtureUser("cashier");
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectLoaded(shellLogo(page, isMobile), /branding\//);
  });

  test("missing uploaded logo falls back to the bundled logo", async ({ page, isMobile }) => {
    await page.route(STORAGE_LOGO, (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"not_found"}' }),
    );
    await page.goto("/login");
    await expectLoaded(page.getByRole("img", { name: LOGO }), /\/brand\/msi-logo-480\.png$/);
    const user = fixtureUser("cashier");
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectLoaded(shellLogo(page, isMobile), /\/brand\/msi-logo-480\.png$/);
  });
});
