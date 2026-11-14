import { randomInt } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yIssues,
  fillExactly,
  signIn,
  signInAs,
} from "./helpers";
import { ownerSql } from "./service";

/*
 * Temporary passwords and the forced change at first sign-in (FR-01; SPEC 4 and 11). The bulk
 * "everyone" action is covered in pgTAP (37_temporary_passwords) only: here it would flag the
 * fixture users that the other tests sign in with.
 */
const unique = () => `${Date.now().toString(36)}${randomInt(1000, 9999)}`;
const GOOD = "river tea lamp orange";

interface NewUser {
  name: string;
  email: string;
  password: string;
}

async function createUser(page: Page, tag: string): Promise<NewUser> {
  const id = unique();
  const user = { name: `Sia ${tag} ${id}`, email: `e2e.pw.${id}@loandesk.test` };
  await page.goto("/settings?tab=users");
  await page.getByRole("button", { name: "Add user" }).click();
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Role").selectOption("manager");
  await page.getByRole("button", { name: "Create user" }).click();
  const password = (await page.getByTestId("one-time-password").textContent())?.trim() ?? "";
  expect(password).toMatch(/^[A-Za-z0-9]{14}$/);
  await expect(page.getByTestId("one-time-password-expiry")).toContainText("It stops working on");
  return { ...user, password };
}

function userRow(page: Page, user: NewUser) {
  return page.getByRole("listitem").filter({ hasText: user.email });
}

/** Opens a separate browser for the new user and signs in there. */
async function newUserPage(browser: Browser, page: Page, user: NewUser, password = user.password) {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const other = await context.newPage();
  await other.goto("/login");
  await signIn(other, user.email, password);
  return other;
}

async function setPassword(page: Page, password: string, current?: string) {
  const submit = page.getByRole("button", {
    name: current === undefined ? "Save my password" : "Change password",
  });
  // React resets uncontrolled fields when the previous submission finishes: wait for it first.
  await expect(submit).toBeEnabled();
  if (current !== undefined) await fillExactly(page.getByLabel("Current password"), current);
  await fillExactly(page.getByLabel("New password", { exact: true }), password);
  await fillExactly(page.getByLabel("Type the new password again"), password);
  await submit.click();
}

test.describe("temporary passwords (FR-01, SPEC 11)", () => {
  test.beforeEach(async ({ page }) => {
    test.slow(); // each test drives two browsers through many round trips
    await signInAs(page, fixtureUser("admin"));
  });

  test("a new user must set a password before anything else, with the rules checked", async ({
    page,
    browser,
  }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const user = await createUser(page, "Forced");
    await page.getByRole("button", { name: "Copy password" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(user.password);
    await page.getByRole("button", { name: "I have noted it" }).click();
    await expect(userRow(page, user).getByTestId("user-status")).toContainText("Must set password (expires");

    const other = await newUserPage(browser, page, user);
    await expect(other).toHaveURL(/\/account\/password$/);
    await expect(other.getByRole("heading", { level: 1, name: "Set your own password" })).toBeVisible();
    await expect(other).toHaveTitle("Password · MSI-Dashboard");
    await expectNoSeriousA11yIssues(other);
    await expectNoHorizontalScroll(other);

    for (const path of ["/loans", "/dashboard"]) {
      await other.goto(path);
      await expect(other).toHaveURL(/\/account\/password$/);
    }

    await setPassword(other, "qwertyuiopas");
    await expect(other.locator("#newPassword-error")).toContainText("Do not use a run of keys");
    await setPassword(other, `${user.name.split(" ")[1] ?? ""} likes tea`);
    await expect(other.locator("#newPassword-error")).toContainText("Do not use your name");
    await setPassword(other, "short");
    await expect(other.locator("#newPassword-error")).toContainText("Use at least 10 characters.");
    await expect(other.getByRole("button", { name: "Save my password" })).toBeEnabled();
    await fillExactly(other.getByLabel("New password", { exact: true }), GOOD);
    await fillExactly(other.getByLabel("Type the new password again"), `${GOOD}x`);
    await other.getByRole("button", { name: "Save my password" }).click();
    await expect(other.locator("#confirmPassword-error")).toHaveText(
      "The two new passwords are not the same.",
    );
    await setPassword(other, user.password);
    await expect(other.getByRole("alert").first()).toBeVisible();
    await expect(other).toHaveURL(/\/account\/password$/);

    await setPassword(other, GOOD);
    await expect(other).toHaveURL(/\/dashboard\?notice=password-changed$/);
    await expect(other.getByText("Your new password is saved.")).toBeVisible();
    await other.goto("/loans");
    await expect(other).toHaveURL(/\/loans$/);
    await other.context().close();

    await page.reload();
    await expect(userRow(page, user).getByTestId("user-status")).toHaveText("Active");
  });

  test("an expired temporary password is refused at sign-in", async ({ page, browser }) => {
    const user = await createUser(page, "Expired");
    ownerSql(
      `update public.profiles set temp_password_expires_at = now() - interval '1 minute'
        where id = (select id from auth.users where email = '${user.email}')`,
    );
    const other = await newUserPage(browser, page, user);
    await expect(other.locator("#login-error")).toHaveText(
      "Your temporary password has expired. Ask the administrator for a new one.",
    );
    await expect(other).toHaveURL(/\/login/);
    await other.context().close();

    await page.goto("/settings?tab=users");
    await expect(userRow(page, user).getByTestId("user-status")).toHaveText("Temporary password expired");
  });

  test("a voluntary change needs the right current password; reset and require restart the flow", async ({
    page,
    browser,
    isMobile,
  }) => {
    const user = await createUser(page, "Voluntary");
    await page.getByRole("button", { name: "I have noted it" }).click();
    const other = await newUserPage(browser, page, user);
    await expect(other).toHaveURL(/\/account\/password$/);
    await setPassword(other, GOOD);
    await expect(other).toHaveURL(/\/dashboard/);

    // From the user menu.
    if (isMobile) {
      await other.getByRole("button", { name: "More" }).click();
      await other.getByRole("dialog").getByRole("link", { name: "Change password" }).click();
    } else {
      await other.getByTestId("top-bar-user").getByRole("link", { name: "Change password" }).click();
    }
    await expect(other.getByRole("heading", { level: 1, name: "Change password" })).toBeVisible();
    await expectNoSeriousA11yIssues(other);
    await setPassword(other, "blue canoe at dawn", "not the password");
    await expect(other.locator("#currentPassword-error")).toHaveText("The current password is not correct.");
    await setPassword(other, "blue canoe at dawn", GOOD);
    await expect(other).toHaveURL(/\/dashboard\?notice=password-changed$/);

    // Reset: the old session must sign in again with the new temporary password.
    await page.reload();
    page.once("dialog", (dialog) => void dialog.accept());
    await userRow(page, user)
      .getByRole("button", { name: `Reset password ${user.name}` })
      .click();
    const temporary = (await page.getByTestId("one-time-password").textContent())?.trim() ?? "";
    await page.getByRole("button", { name: "I have noted it" }).click();
    await other.goto("/dashboard");
    await expect(other).toHaveURL(/\/login\?notice=sign-in-again$/);
    await signIn(other, user.email, temporary);
    await expect(other).toHaveURL(/\/account\/password$/);
    await setPassword(other, "green mango season");
    await expect(other).toHaveURL(/\/dashboard/);

    // Require a new password: confirmed with a reason, shown on the user, enforced at next use.
    await page.reload();
    await userRow(page, user)
      .getByRole("button", { name: `Require a new password ${user.name}` })
      .click();
    await page.getByRole("button", { name: "Require a new password", exact: true }).click();
    await expect(page.getByText("Give a reason (at least 3 characters).")).toBeVisible();
    await page.getByLabel("Reason").fill("Security check");
    await page.getByRole("button", { name: "Require a new password", exact: true }).click();
    await expect(page.getByText(`${user.name} must set a new password at next sign-in`)).toBeVisible();
    await expect(userRow(page, user).getByTestId("user-status")).toContainText("Must set password");
    await other.goto("/loans");
    await expect(other).toHaveURL(/\/login\?notice=sign-in-again$/);
    await signIn(other, user.email, "green mango season");
    await expect(other).toHaveURL(/\/account\/password$/);
    await other.context().close();
  });

  test("Settings → Rules has the temporary password hours", async ({ page }) => {
    await page.goto("/settings?tab=rules");
    const field = page.getByLabel("Temporary password valid for (hours)");
    await expect(field).toHaveValue("72");
    await fillExactly(field, "721");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter a whole number of hours from 1 to 720.")).toBeVisible();
  });
});
