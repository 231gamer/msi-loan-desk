import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser, type FixtureKey } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signInAs } from "./helpers";
import { activeTestLoan, ownerSql, userClient } from "./service";

const EXPECTED: Array<[Exclude<FixtureKey, "inactive">, string[]]> = [
  ["loan_officer", ["Due today", "Overdue", "Field cash to hand over", "My due and overdue loans"]],
  ["cashier", ["Collected today", "Cash to close", "Field cash not confirmed"]],
  [
    "manager",
    [
      "Outstanding",
      "Overdue",
      "Approvals waiting",
      "Overdue by age",
      "Needs attention",
      "Due and overdue now",
    ],
  ],
  ["ceo", ["Outstanding", "Approvals waiting", "Needs attention"]],
  ["accountant", ["Cash and equivalents", "Income this month", "Expenses waiting", "Cash by account"]],
  ["admin", ["Go-live date", "Last daily job", "Active users"]],
];

test.describe("role dashboards (SPEC 9 /dashboard; FR-29; mock-up 05)", () => {
  for (const [key, labels] of EXPECTED) {
    test(`${key} sees their own summary`, async ({ page }, testInfo) => {
      await signInAs(page, fixtureUser(key));
      const main = page.getByRole("main");
      for (const label of labels) await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
      if (key === "manager" || key === "cashier") {
        await expectNoSeriousA11yIssues(page);
        if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);
      }
    });
  }
});

test.describe("due and overdue on the dashboard", () => {
  test("phones show one card per loan with amount, due date and status; larger screens the table", async ({
    page,
  }, testInfo) => {
    const n = randomInt(100000, 999999).toString();
    const loan = await activeTestLoan(
      {
        first_name: "Joseph",
        last_name: `Card${n}`,
        phone: `0996 ${n.slice(0, 3)} ${n.slice(3)}`,
        id_type: "national_id",
        id_number: `E2E-D${n}`,
      },
      60000, // owes $720.00
    );
    const manager = await userClient(fixtureUser("manager"));
    const { data: today } = await manager.rpc("business_today");
    // Setup only: the loan falls due today.
    ownerSql(`update public.loans set due_date = '${String(today)}' where id = '${loan.id}'`);

    await signInAs(page, fixtureUser("loan_officer"));
    const panel = page.getByRole("region", { name: "My due and overdue loans" });
    if (testInfo.project.name === "phone-390") {
      const card = panel.getByRole("link", { name: new RegExp(`Joseph Card${n}`) });
      await expect(card).toBeVisible();
      await expect(card).toContainText("$720.00");
      await expect(card).toContainText(loan.loanNo);
      await expect(card).toContainText("Due today");
      await expect(card).toContainText(/Due \d{2} [A-Z][a-z]{2} \d{4}/);
      await expect(panel.getByRole("table")).toBeHidden();
      await expectNoHorizontalScroll(page);
    } else {
      const row = panel.getByRole("row", { name: new RegExp(`Joseph Card${n}`) });
      await expect(row).toContainText("$720.00");
      await expect(row).toContainText("Due today");
    }
  });
});
