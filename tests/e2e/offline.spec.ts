import { randomInt, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { activeTestLoan, ownerSql, serviceClient, userClient } from "./service";

function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Kebeh",
    last_name: `Offline${n}`,
    phone: `0995 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-O${n}`,
  };
}

/* A paid-out loan of the test officer that falls due today (setup only: the due date is moved). */
async function loanDueToday(principalCents: number) {
  const fields = person();
  const loan = await activeTestLoan(fields, principalCents);
  const officer = await userClient(fixtureUser("loan_officer"));
  const { data: user } = await officer.auth.getUser();
  ownerSql(
    `update public.loans set due_date = public.business_today(), officer_id = '${user.user?.id ?? ""}' where id = '${loan.id}'`,
  );
  return { ...loan, name: `${fields.first_name} ${fields.last_name}`, officerId: user.user?.id ?? "" };
}

/** Waits until the service worker runs and has the offline pages, and /field has saved its list. */
async function waitUntilReadyOffline(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          const cached = await caches.match("/offline/field");
          const saved = await new Promise<number>((resolve) => {
            const open = indexedDB.open("loandesk-offline", 1);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains("snapshots")) return resolve(0);
              const count = db.transaction("snapshots").objectStore("snapshots").count();
              count.onsuccess = () => resolve(count.result);
              count.onerror = () => resolve(0);
            };
            open.onerror = () => resolve(0);
          });
          return (
            registration?.active !== undefined &&
            registration.active !== null &&
            cached !== undefined &&
            saved > 0
          );
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test.describe("installable app and offline field cash (SPEC addendum B)", () => {
  test("the app can be installed and the offline pages hold no data", async ({ page, request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    const body = (await manifest.json()) as { display: string; icons: { sizes: string; purpose: string }[] };
    expect(body.display).toBe("standalone");
    expect(body.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(
      expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]),
    );
    const worker = await request.get("/sw.js");
    expect(worker.status()).toBe(200);

    // Signed out, the offline page opens (it is static) and Field cash offline shows no list.
    await page.goto("/offline/field");
    await expect(page.getByRole("heading", { name: "Field cash (offline)", level: 1 })).toBeVisible();
    await expect(page.getByText(/No saved list on this phone/)).toBeVisible();
    await expectNoSeriousA11yIssues(page);
  });

  test("the More menu offers Install app with the steps when the browser has no install dialog", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "phone-390", "the More menu is the phone navigation");
    await signInAs(page, fixtureUser("cashier"));
    await page.getByRole("button", { name: "More" }).click();
    const install = page.getByRole("button", { name: "Install app" });
    await expect(install).toBeVisible();
    await install.click();
    await expect(page.getByText('Choose "Install app" or "Add to Home screen".')).toBeVisible();
    await expectNoSeriousA11yIssues(page);
  });

  test("the sync address refuses other sites, signed-out visitors and other roles", async ({ page }) => {
    const payload = {
      key: randomUUID(),
      userId: randomUUID(),
      loanId: randomUUID(),
      amountCents: "1000",
      method: "cash",
      reference: "",
    };
    const headers = { "content-type": "application/json", "x-loandesk-offline": "1" };

    // Signed out: the proxy sends it to sign-in; nothing is recorded.
    const signedOut = await page.request.post("/api/field/payments", {
      data: payload,
      headers,
      maxRedirects: 0,
    });
    expect([302, 307, 401]).toContain(signedOut.status());

    await signInAs(page, fixtureUser("cashier"));
    const cashier = await page.request.post("/api/field/payments", { data: payload, headers });
    expect(cashier.status()).toBe(403);

    await page.context().clearCookies();
    await signInAs(page, fixtureUser("loan_officer"));
    const noHeader = await page.request.post("/api/field/payments", {
      data: payload,
      headers: { "content-type": "application/json" },
    });
    expect(noHeader.status()).toBe(403);
    const otherSite = await page.request.post("/api/field/payments", {
      data: payload,
      headers: { ...headers, origin: "https://evil.example" },
    });
    expect(otherSite.status()).toBe(403);
    // Another officer's payment waits for them: it is never recorded under whoever is signed in.
    const otherUser = await page.request.post("/api/field/payments", { data: payload, headers });
    expect(otherUser.status()).toBe(409);
  });

  test("the officer records a payment offline, gets a slip, and it is recorded once when back online", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(120_000);
    const loan = await loanDueToday(60000); // owes $720.00

    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto("/field");
    await expect(page.getByRole("article", { name: loan.name })).toBeVisible();
    await waitUntilReadyOffline(page);

    // No signal: opening Field cash shows the offline screen with the saved list.
    await context.setOffline(true);
    await page.goto("/field").catch(() => undefined);
    await expect(page.getByRole("heading", { name: "Field cash (offline)", level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "No signal" })).toBeVisible();
    const card = page.getByRole("article", { name: loan.name });
    await expect(card).toContainText("$720.00");
    await expectNoSeriousA11yIssues(page);
    if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);

    await card.getByRole("button", { name: `Collect from ${loan.name}` }).click();
    await fillExactly(page.getByLabel("Amount ($)"), "100.00");
    await page.getByRole("button", { name: "Save payment" }).click();
    const slip = page.getByTestId("offline-slip");
    await expect(slip).toContainText("Payment saved: not sent yet");
    await expect(slip).toContainText(/OFF-[0-9A-F]{6}/);
    await expect(slip).toContainText("$100.00");
    await expect(slip).toContainText("This is not the official receipt");
    await page.getByRole("button", { name: "Done" }).click();
    const item = page.getByTestId("offline-queue-item").filter({ hasText: loan.loanNo });
    await expect(item).toContainText("Waiting to send");
    // The card says it was already collected, so the officer does not collect it twice.
    await expect(card).toContainText("$100.00 already recorded on this phone");

    // Nothing reached the server while offline.
    const before = await serviceClient().from("payments").select("id").eq("loan_id", loan.id);
    expect(before.data).toHaveLength(0);

    // Signal is back: the queue sends itself and the slip gets its receipt number.
    await context.setOffline(false);
    await expect(item).toContainText(/Sent: receipt RCT-/, { timeout: 30_000 });

    const { data: payments } = await serviceClient()
      .from("payments")
      .select("id, amount_cents, reference, collected_in_field, idempotency_key, received_by")
      .eq("loan_id", loan.id);
    expect(payments).toHaveLength(1);
    const payment = payments?.[0];
    expect(payment).toMatchObject({
      amount_cents: 10000,
      collected_in_field: true,
      received_by: loan.officerId,
    });
    expect(payment?.reference).toMatch(/^Collected offline \d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/);

    // Sending the same payment again records nothing new (the request key).
    const again = await page.request.post("/api/field/payments", {
      data: {
        key: payment?.idempotency_key,
        userId: loan.officerId,
        loanId: loan.id,
        amountCents: "10000",
        method: "cash",
        reference: payment?.reference,
      },
      headers: { "content-type": "application/json", "x-loandesk-offline": "1" },
    });
    expect(again.status()).toBe(200);
    expect(((await again.json()) as { paymentId: string }).paymentId).toBe(payment?.id);
    const after = await serviceClient().from("payments").select("id").eq("loan_id", loan.id);
    expect(after.data).toHaveLength(1);

    // Back on Field cash with signal, the payment is listed as field cash with its receipt.
    const { data: recorded } = await serviceClient()
      .from("payments")
      .select("receipt_no")
      .eq("id", payment?.id ?? "")
      .single();
    await page.goto("/field");
    await expect(page.getByRole("link", { name: recorded?.receipt_no ?? "-" })).toBeVisible();
    // Move the loan out of today so it does not crowd other tests' lists.
    ownerSql(`update public.loans set due_date = due_date + 30 where id = '${loan.id}'`);
  });

  test("signing out wipes the saved list but keeps payments not yet sent", async ({ page, context }) => {
    test.setTimeout(90_000);
    const loan = await loanDueToday(40000);
    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto("/field");
    await waitUntilReadyOffline(page);

    await context.setOffline(true);
    await page.goto("/offline/field").catch(() => undefined);
    const card = page.getByRole("article", { name: loan.name });
    await card.getByRole("button", { name: `Collect from ${loan.name}` }).click();
    await fillExactly(page.getByLabel("Amount ($)"), "25.00");
    await page.getByRole("button", { name: "Save payment" }).click();
    await page.getByRole("button", { name: "Done" }).click();

    // Signing out lands on the sign-in page, which clears the list from the phone. (Signed out
    // before the signal returns, so the payment cannot be sent yet.)
    await context.clearCookies();
    await context.setOffline(false);
    await page.goto("/login");
    // The sign-in page clears the list in the background; wait until it has.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const open = indexedDB.open("loandesk-offline", 1);
              open.onsuccess = () => {
                const count = open.result.transaction("snapshots").objectStore("snapshots").count();
                count.onsuccess = () => resolve(count.result);
                count.onerror = () => resolve(-1);
              };
              open.onerror = () => resolve(-1);
            }),
        ),
      )
      .toBe(0);
    await context.setOffline(true);
    await page.goto("/offline/field").catch(() => undefined);
    await expect(page.getByText(/No saved list on this phone/)).toBeVisible();
    await expect(page.getByTestId("offline-queue-item").filter({ hasText: loan.loanNo })).toContainText(
      "Waiting to send",
    );

    // Signing in again sends it.
    await context.setOffline(false);
    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto("/field");
    await expect
      .poll(
        async () => (await serviceClient().from("payments").select("id").eq("loan_id", loan.id)).data?.length,
        {
          timeout: 30_000,
        },
      )
      .toBe(1);
    ownerSql(`update public.loans set due_date = due_date + 30 where id = '${loan.id}'`);
  });
});
