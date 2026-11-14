# LoanDesk user guide

For MSI staff. Each section says who does the step. Money is in US dollars; dates are shown as 05 Feb 2026.

## Installing the app and working offline

### Install on a phone
- Sign in, open **More** and tap **Install app**. On Android, Chrome asks to install; tap **Install**.
- On an iPhone, the steps appear instead: tap the browser's **Share** button, choose **Add to Home Screen**, then **Add**.
- The app then opens from its own icon, full screen. Updates arrive by themselves.
- On an iPhone, payments taken offline send when the app is opened with signal (iPhones do not send in the background).

### Field cash without signal (loan officers)
- Open **Field cash** once a day with signal. Your list is then saved on the phone for 72 hours.
- With no signal, open Field cash as usual. You see your saved list. Tap **Collect**, enter the amount (and the transaction reference for mobile money or bank), then **Save payment**.
- Show the borrower the slip. It is **not** the official receipt: it has a reference starting with `OFF-`.
- When the phone has signal again, the payment sends itself. The slip then shows "Sent: receipt RCT-…" and you can open the official receipt.
- The payment is dated the day it is sent. Its reference says when you really collected it.
- If the server refuses a payment (for example the loan was already paid off), it shows "Not recorded" with the reason. Keep the cash and give the slip to the cashier.
- Signing out removes your list from the phone. Payments not yet sent stay and send the next time you sign in on the same phone.

## Installment loans

Some borrowers repay in equal monthly installments instead of one payment at the end. Choose the product **"Installment loan (monthly)"** (the admin can change it under Settings → Loan products).

How it works:

- **Interest is charged once**, when the loan is paid out: amount lent × the product's rate (20% today), whatever the number of months. Example: $2,000 over 4 months → interest $400.00 → total $2,400.00.
- **Equal monthly installments**: $2,400.00 / 4 = **$600.00 a month**. If the total does not divide evenly, the last installment takes the few cents left over ($1,200.00 in 7: six of $171.42, then $171.48).
- The **first installment is due one month after payout**, the next a month later, and so on. The last installment's date is the loan's **final due date**.
- **Nothing extra is charged within the term.** If an installment is paid late or in part, the loan is **behind schedule**: it shows on the due list for follow-up, but no penalty or extra interest is added.
- **After the final due date**, if money is still owed, the loan is **overdue** and the normal late-payment rules apply: a penalty of 20% of everything still owed every 7 days, up to 4 times, and recovery can start 30 days after the final due date.
- Borrowers can pay **any amount at any time**, including paying the loan off early. Interest was charged once at payout, so there is **no discount for paying early**.
- Installment loans **cannot be extended** in this version.

### 1. Applying (loan officer or manager)

1. **Loans → New loan**, choose the customer.
2. **Amount and term**: choose **Installment loan (monthly)**, the number of months (2 to 6; one installment per month) and the amount. The box below shows the interest (charged once), the total, the monthly amount and the **repayment schedule if paid out today** (number, date, amount) with the total.
3. Add collateral and guarantors as for any loan.
4. **Check and send** shows the schedule again. Press **Send for approval**.

The dates in the schedule count from the day the loan is paid out, so they can move if the loan is paid out on another day; the amounts do not change.

### 2. Approving (manager or CEO)

The approvals card shows the amount, interest, total and "**4 × $600.00 monthly**". The usual limits apply: a manager approves up to the limit, the CEO above it, and nobody approves their own application.

### 3. Paying out (cashier)

Pay the loan out as usual from the loan page. At payout the schedule is fixed: the dates count from that day and cannot be changed afterwards.

### 4. The loan page

- **Outstanding** shows what is still owed, then **Next installment: $600.00 due 15 Mar 2026 (installment 2 of 4)**. If an installment is unpaid after its date it also says **Behind schedule: $600.00 unpaid since 15 Feb 2026 (23 days). No charge while the loan is within its term.**
- **Repayment schedule** lists every installment with its date, amount, what is paid, what is still owed and its status:

| Status | Meaning |
| --- | --- |
| Paid | Nothing left on this installment |
| Part paid | Some of it is paid; its date has not passed |
| Due | The next installment to pay |
| Behind | Its date has passed and something is still owed |
| Not yet due | A later installment |

Payments cover the **oldest installment first**. Only money that goes to interest and the amount lent counts toward installments; a payment of a penalty (after the final due date) clears the penalty, not an installment. That way the schedule always agrees with the Outstanding card.

### 5. Taking a payment (cashier at the counter, loan officer in the field)

The payment form shows the installment due, for example **Next installment (2) due 15 Mar 2026: $600.00**, or, when the loan is behind, everything due by today. Press **Use this amount** to fill it in. You can still type any other amount (more, less, or the whole balance).

The **receipt** shows the balance after the payment and **Next installment: $600.00 due 15 Mar 2026**. When the loan is paid off, that line is not printed.

### 6. Due and overdue list, Today, dashboard

For installment loans inside their term, these screens show the **installment due** (its amount and date), not the whole balance:

- **Due today** and **Due in N days**: installments falling due.
- **Behind schedule** (new tab and card): installment loans with an unpaid installment whose date has passed. They are **not** overdue: no penalty is charged. Call or send a WhatsApp reminder.
- **Overdue**: loans past their **final** due date with money owed, exactly as for one-payment loans.

The WhatsApp reminder for an installment uses its own text (Settings → WhatsApp reminder texts → "Reminder for an installment"). It names the installment, its amount and date, and the total still owed.

Reports → **Due loans** lists installments due today and in the next days, and a **Behind schedule** section. The **Overdue** report lists only loans past their final due date.

### 7. Documents

- **Loan agreement**: the repayment schedule and the installment wording (interest charged once; no penalty or extra interest within the term; penalties only after the final due date). Before payout the schedule shows "1 month after payout", "2 months after payout", and so on.
- **Statement**: every movement as before, plus the repayment schedule with each installment's status today.

### "Behind schedule" or "overdue"?

| | Behind schedule | Overdue |
| --- | --- | --- |
| When | An installment date has passed with money unpaid, **before** the final due date | The **final** due date has passed with money owed |
| Extra charges | None | Penalty every 7 days (up to 4), recovery after 30 days |
| Where it shows | Behind schedule tab and card, loan page | Overdue tab and card, Overdue report, loan page |
| What to do | Follow up: call or remind | Follow up; after 30 days the manager can open recovery |
