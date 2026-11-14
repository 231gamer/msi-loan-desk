import { expect, test, type Locator } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signIn, signInAs } from "./helpers";

test.describe("app shell (SPEC 9 layout, mock-ups 05-15 and 01-03)", () => {
  test.beforeEach(async ({ page }) => {
    const user = fixtureUser("cashier");
    await page.goto("/login");
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("desktop: sidebar with logo tile, icons and active navigation; the user in the top bar", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop layout");
    const sidebar = page.getByRole("complementary");
    await expect(sidebar.getByRole("img", { name: "Method Solutions Inc. logo" })).toBeVisible();
    await expect(sidebar.getByText("Loan management")).toBeVisible();
    const dashboard = sidebar.getByRole("link", { name: "Dashboard" });
    await expect(dashboard).toHaveAttribute("aria-current", "page");
    // Every menu item has its icon.
    const links = sidebar.getByRole("navigation").getByRole("link");
    for (const link of await links.all()) await expect(link.locator("svg")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true })).toHaveCount(1);
    await expect(page.locator("header").getByText("Margibi Branch", { exact: true })).toBeVisible();

    // The user, role and password link are in the top bar; the sidebar foot has sign-out only.
    const user = page.getByTestId("top-bar-user");
    await expect(user.getByText("Test Cashier")).toBeVisible();
    await expect(user.getByText("Cashier", { exact: true })).toBeVisible();
    await expect(user.getByRole("link", { name: "Change password" })).toBeVisible();
    await expect(sidebar.getByText("Test Cashier")).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("desktop: menu items and buttons explain themselves on hover", async ({ page, isMobile }) => {
    test.skip(isMobile, "hover is a desktop pointer action");
    const sidebar = page.getByRole("complementary");
    // A real pointer glides between controls; the test parks it on empty page first, then hovers.
    const hover = async (target: Locator) => {
      await page.mouse.move(700, 760);
      await target.hover({ position: { x: 4, y: 4 } });
      await target.hover();
    };
    await hover(sidebar.getByRole("link", { name: "Customers" }));
    // A tip stays open while the pointer may still travel onto it, so each is found by its text.
    await expect(
      page.getByRole("tooltip").filter({ hasText: "Find, register and update borrowers" }),
    ).toBeVisible();
    await hover(page.getByTestId("top-bar-user").getByRole("link", { name: "Change password" }));
    await expect(
      page.getByRole("tooltip").filter({ hasText: "Change the password you sign in with" }),
    ).toBeVisible();
    await hover(page.getByRole("main").getByRole("link", { name: "Receive payment" }));
    await expect(
      page.getByRole("tooltip").filter({ hasText: "Take a payment at the counter" }),
    ).toBeVisible();
  });

  test("desktop: the menu collapses to icons and stays collapsed after a reload", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop layout");
    const sidebar = page.getByRole("complementary");
    const before = (await sidebar.boundingBox())?.width ?? 0;
    await sidebar.getByRole("button", { name: "Collapse menu" }).click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(before / 2);
    // Labels stay available to screen readers and in tooltips.
    const customers = sidebar.getByRole("link", { name: "Customers" });
    await expect(customers).toBeVisible();
    await page.mouse.move(700, 760);
    await customers.hover({ position: { x: 4, y: 4 } });
    await customers.hover();
    await expect(page.getByRole("tooltip").filter({ hasText: "Customers" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("complementary")).toHaveAttribute("data-collapsed", "true");
    await expectNoSeriousA11yIssues(page);
    await page.getByRole("complementary").getByRole("button", { name: "Expand menu" }).click();
    await expect(page.getByRole("complementary")).toHaveAttribute("data-collapsed", "false");
    await expect(page.getByRole("complementary").getByText("Loan management")).toBeVisible();
  });

  test("desktop: only pages that exist and the role may open are listed", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop layout");
    const links = page.getByRole("complementary").getByRole("navigation").getByRole("link");
    await expect(links).toHaveText([
      "Dashboard",
      "Customers",
      "Loans",
      "Payments",
      "Field cash",
      "Due and overdue",
      "Collateral",
      "Approvals",
      "Day close",
    ]);
  });

  test("phone: purple header with context line, bottom tabs and the More sheet", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone layout");
    await expect(page.getByRole("complementary")).toBeHidden();
    await expect(page.getByText("Test Cashier · Cashier · Margibi Branch")).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Main" });
    await expect(tabs.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    const tabBox = await tabs.getByRole("link", { name: "Dashboard" }).boundingBox();
    expect(tabBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await tabs.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "All pages" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Signed in as Test Cashier, Cashier")).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    await sheet.getByRole("button", { name: "Close menu" }).click();
    await expect(sheet).toBeHidden();
  });

  test("the business date and branch are shown, with no horizontal scroll at 360px", async ({ page }) => {
    await expect(page.getByTestId("business-date")).toHaveText(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2} [A-Z][a-z]{2} \d{4} · Margibi Branch$/,
    );
    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalScroll(page);
  });

  test("a skip link jumps to the main content", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });
});

test.describe("phone tab bar labels", () => {
  test("long page names get a short one-line tab label; the full name stays for screen readers", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone layout");
    await signInAs(page, fixtureUser("admin"));
    await page.setViewportSize({ width: 360, height: 780 });
    const tabs = page.getByRole("navigation", { name: "Main" });
    const due = tabs.getByRole("link", { name: "Due and overdue" });
    await expect(due).toHaveText("Due");
    // Every tab label sits on one line: as tall as the shortest label.
    const heights = await tabs
      .locator("a > span, button > span")
      .evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThanOrEqual(Math.min(...heights) + 1);
    await tabs.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "Due and overdue" })).toBeVisible();
  });
});
