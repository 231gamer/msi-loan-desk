import { randomInt } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { createTestCustomer, fundCash, ownerSql, serviceClient } from "./service";

function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Musu",
    last_name: `Installment${n}`,
    phone: `0994 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-I${n}`,
  };
}

async function switchUser(page: Page, key: "loan_officer" | "manager" | "cashier") {
  await page.context().clearCookies();
  await signInAs(page, fixtureUser(key));
}

/*
 * Installment loans end to end (SPEC addendum "Installment loans"): $2,000 over 4 months is
 * $2,400 in 4 x $600. The officer applies, the manager approves, the cashier pays out and takes
 * the first installment; the loan page, receipt, due list and PDFs follow the schedule.
 */
test.describe("installment loans (SPEC addendum)", () => {
  test("apply, approve, pay out, schedule, first installment paid, due list, receipt and PDFs", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const fields = person();
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);

    // 1. The officer applies for $2,000 over 4 months and sees 4 x $600.00.
    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto(`/loans/new?customer=${customer.id}`);
    await expect(page.getByRole("heading", { name: "Step 2 of 5: Amount and term" })).toBeVisible();
    const { data: product } = await serviceClient()
      .from("loan_products")
      .select("id")
      .eq("name", "Installment loan (monthly)")
      .single();
    await page.getByLabel("Loan product").selectOption(product?.id ?? "");
    await expect(page.getByLabel("Loan product")).toContainText(
      "20% interest charged once, monthly installments",
    );
    await page.getByLabel("Term", { exact: true }).selectOption("4");
    await fillExactly(page.getByLabel("Amount to lend ($)"), "2,000");
    const preview = page.locator("[aria-live=polite]").filter({ hasText: "Total to repay" });
    await expect(preview).toContainText("Interest (charged once)$400.00");
    await expect(preview).toContainText("Each month$600.00");
    const schedule = preview.getByRole("table", { name: "Repayment schedule" });
    await expect(schedule.locator("tbody tr")).toHaveCount(4);
    for (const row of await schedule.locator("tbody tr").all()) await expect(row).toContainText("$600.00");
    await expect(schedule.locator("tfoot")).toContainText("$2,400.00");
    await expect(preview).toContainText("Interest of 20% is charged once");
    await expectNoSeriousA11yIssues(page);
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByRole("button", { name: "Add a new item" }).click();
    await page.getByLabel("Type").selectOption("electronics");
    await fillExactly(page.getByLabel("Description"), "Samsung fridge RT38");
    await fillExactly(page.getByLabel("Serial number (optional)"), `FR-${fields.id_number}`);
    await fillExactly(page.getByLabel("Estimated value ($)"), "3000");
    await page.getByRole("button", { name: "Add item" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Step 4 of 5: Guarantors" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { name: "Step 5 of 5: Check and send" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Repayment schedule" }).locator("tbody tr")).toHaveCount(4);
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(page).toHaveURL(/\/loans\/[0-9a-f-]{36}\?submitted=1$/);
    const loanId = /\/loans\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
    const db = serviceClient();
    const { data: submitted } = await db
      .from("loans")
      .select("loan_no, repayment_type, installment_count, interest_cents, status")
      .eq("id", loanId)
      .single();
    expect(submitted).toMatchObject({
      repayment_type: "installments",
      installment_count: 4,
      interest_cents: 40000,
      status: "pending_approval",
    });
    const loanNo = submitted?.loan_no ?? "";

    // 2. The manager sees "4 x $600.00 monthly" and approves.
    await switchUser(page, "manager");
    await page.goto("/approvals");
    const card = page.getByRole("article").filter({ hasText: loanNo });
    await expect(card).toContainText("4 × $600.00 monthly");
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toHaveCount(0);

    // 3. The cashier pays out; the loan page shows the schedule and the next installment.
    await fundCash("1010-BR2", 700000); // with a buffer: parallel tests pay out of the same cash
    await switchUser(page, "cashier");
    await page.goto(`/loans/${loanId}`);
    await page.getByLabel("Paid out by").selectOption("cash");
    await page.getByRole("button", { name: "Pay out" }).click();
    await page.getByRole("button", { name: "Yes, pay out" }).click();
    const card4 = page.getByTestId("repayment-schedule");
    await expect(card4).toBeVisible();
    await expect(card4).toContainText("4 monthly installments, interest charged once");
    const { data: installments } = await db
      .from("loan_installments")
      .select("installment_no, due_date, amount_cents")
      .eq("loan_id", loanId)
      .order("installment_no");
    expect(installments?.map((row) => row.amount_cents)).toEqual([60000, 60000, 60000, 60000]);
    await expect(page.getByTestId("installment-summary")).toContainText(
      /Next installment: \$600\.00 due \d{2} [A-Z][a-z]{2} \d{4} \(installment 1 of 4\)/,
    );
    await expect(page.getByRole("button", { name: /extension/i })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Activity", exact: true })).toContainText(
      "Interest charged (20%, once)",
    );
    await expectNoSeriousA11yIssues(page);
    await expectNoHorizontalScroll(page);

    // 4. The cashier takes the suggested $600.00; the receipt shows the next installment.
    await page.goto(`/payments/new?loan=${loanId}`);
    const suggestion = page.getByTestId("installment-suggestion");
    await expect(suggestion).toContainText("Next installment (1) due");
    await expect(suggestion).toContainText("$600.00");
    await suggestion.getByRole("button", { name: "Use this amount" }).click();
    await expect(page.getByLabel("Amount (USD)")).toHaveValue("600.00");
    await page.getByRole("button", { name: "Receive payment" }).click();
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);
    const second = installments?.[1]?.due_date ?? "";
    const [year, month, day] = second.split("-").map(Number);
    const secondLabel = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).toLocaleDateString(
      "en-GB",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      },
    );
    await expect(page.getByTestId("receipt-next-installment")).toContainText(`$600.00 due ${secondLabel}`);
    await expectNoSeriousA11yIssues(page);

    // 5. The first installment shows Paid.
    await page.goto(`/loans/${loanId}`);
    const firstLine = isPhone(page)
      ? page.getByTestId("repayment-schedule").getByRole("listitem").first()
      : page.getByTestId("repayment-schedule").getByRole("row").nth(1);
    await expect(firstLine).toContainText("Paid");
    await expect(page.getByTestId("installment-summary")).toContainText("(installment 2 of 4)");

    // 6. Setup only: move the schedule so installment 2 falls due in 3 days (the schedule is
    //    immutable for the app, so this runs with triggers off, like the due-date moves elsewhere).
    ownerSql(`do $$
      begin
        alter table public.loan_installments disable trigger loan_installments_immutable;
        update public.loan_installments i set due_date = i.due_date - s.shift
          from (select (due_date - (public.business_today() + 3)) as shift from public.loan_installments
                 where loan_id = '${loanId}' and installment_no = 2) s
         where i.loan_id = '${loanId}';
        alter table public.loan_installments enable trigger loan_installments_immutable;
        update public.loans set due_date = (select max(due_date) from public.loan_installments where loan_id = '${loanId}')
         where id = '${loanId}';
      end $$`);
    await switchUser(page, "loan_officer");
    await page.goto("/due?tab=soon");
    const dueRow = isPhone(page)
      ? page.getByRole("listitem").filter({ hasText: loanNo })
      : page.getByRole("row").filter({ hasText: loanNo });
    await expect(dueRow).toContainText(/installment 2( due|, of \$1,800\.00 owed)/);
    await expect(dueRow).toContainText("$600.00");
    await expectNoSeriousA11yIssues(page);

    // 7. The agreement and statement PDFs open.
    for (const href of [`/api/pdf/loan_agreement/${loanId}`, `/api/pdf/statement/${loanId}`]) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
      expect(response.headers()["content-type"]).toBe("application/pdf");
      expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
    }
  });
});

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 768;
}
