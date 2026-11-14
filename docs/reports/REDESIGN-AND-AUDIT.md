# Redesign and system audit: summary (14 Nov 2026)

What was done in this round, why, and what is still open. Three pull requests, each merged once its CI checks passed.

| PR | Phase | What |
|----|-------|------|
| #5 | R1 | Approvals page redesign, the shared list and detail style, table headings, scrolling tabs on phones |
| #6 | R2 | Statement of account, loan agreement and the other PDF documents |
| #7 | R3 + R4 | The style applied to the other pages, a readable audit log, and copy fixes |

## Direction and decisions

The three mock-ups were used as a guide, not copied. They were never meant as a pixel template. The decisions:

- **Keep the MSI brand.** That means MSI purple, the yellow accent, the logo and Inter, the only typeface (your answer). We added no new colours or fonts and no decorative extras.
- **Minimal, not plain.** Information is grouped with one border and white space instead of stacked cards and shadows. Labels sit above values (the new `.kv` block). Secondary details are stacked under the main value instead of getting their own column.
- **Restyle the shared patterns, not each page.** Tables, label and value blocks, tabs, chips and info notes changed once and every page picked them up. This kept the change small and low-risk ("don't over-engineer").
- **Page titles stay in the top bar.** The mock-ups repeated the title in the page body. We didn't, because the top bar already shows it on every device.
- **Skipped on purpose (your answer):** the branch switcher and the approvals search from the mock-ups. Both would be new features outside FR-01..FR-29.
- **No money, permission or database changes** in any of the three PRs. Only screens, documents and wording changed.

## R1: Approvals and the shared style (#5)

- Each request is one row: what is being asked on the left, then who asked, when, the status and the decision on the right (stacked on phones).
- Approve and Reject are side by side with icons. The reason box only appears when you press Reject, and a rejection asks "Yes, reject" before it is sent. Write-offs still show the board reference box straight away, because it is required to approve.
- Type chips, an info note at the foot of the list, and label and value blocks with a thin left rule.
- All table headings are slightly larger and darker, so they are easier to read.
- Tab rows (Loans, Approvals, Due, Collateral, Expenses) scroll sideways on phones instead of wrapping onto three lines.

## R2: Documents (#6)

- A shared PDF kit (`src/lib/pdf/parts.tsx`) used by every document. It covers:
  - the header (logo, company lines, document number and date);
  - a title with a purple accent bar;
  - detail blocks;
  - tables with a purple heading band and a tinted total row;
  - status chips in the statement schedule;
  - a footer with the preparer, the verify link and the QR code, plus a thin brand bar.
- Loan agreement terms are numbered clauses with a bold lead-in. The repayment schedule no longer leaves a gap at the bottom of page 1.
- The footer is one fixed row, which fixed a bug where it vanished on some pages.

## R3: The other pages (#7)

- **Loans, collateral and payments** tables stack secondary details (branch and officer, owner and loan, receipt and date), so they fit at 1280px without clipping. Amounts, statuses and loan numbers don't wrap, and rows have a quiet hover.
- **Payments** filters were truncated ("Any meth…"). They now use a 2- or 4-column grid.
- **Customer page:** the "open approvals" link moved inside the pending-change note it belongs to.
- **Day close** cards no longer stretch to match each other. **Report** cards align their text to the top. **Expenses** "Paid from" codes don't wrap.
- **Phones:** long customer names on loan cards pushed the page 9px sideways at 390px. They now wrap, and "lent $X" and "owes $Y" stay on one line.

## R4: Wording and the audit log (#7)

- **Audit log:**
  - Every action now has a plain label, for example "Payment received" instead of `payment.received` and "Loan paid out" instead of `loan.disbursed`.
  - Records show their number or name instead of a long ID: loan number, receipt, expense, collateral code, case, journal, customer, approval type, document kind.
  - Loans, customers and receipts link to their pages.
  - The "Record type" filter now lists every type, not just four.
- **Recovery page:** the intro showed a raw `{count}` placeholder. The recovery limit is set per loan product, so the sentence now says "once it passes the recovery limit on its loan product".
- **Settings:** "Leave empty until MSI confirms it…" read like a note from the builder. It now says "Can stay empty for now. Empty fields are left blank on printed documents."
- A sweep for AI-sounding or builder wording ("seamless", "ensure", "simply", spec references and so on) found nothing else in the interface text.
- **Changelog:** installment loans are marked as deployed.

## Audit: what was tested

| Check | Result |
|-------|--------|
| Unit tests | 363 passed |
| Database tests (pgTAP) | 729 passed in 40 files |
| End-to-end suite at 390px and 1280px (all roles, all flows, accessibility checks) | 227 passed, 9 skipped (live-only tests) |
| Page sweep on demo data: every page for each of the 6 roles at 390px and 1280px, checking for horizontal scroll, raw placeholders, `undefined`/`NaN`, error pages and server errors | All clean after the fixes above (60+ pages) |
| Every PDF type on demo data: 12 agreements, 12 statements, 7 receipts, 13 collateral receipts, release letters, the demand notice | All render. Release letters are refused for items not yet released, which is correct. |
| Lint, typecheck, production build, secret scan, CodeQL | Clean |

**Bugs found and fixed:**
- the raw `{count}` on Recovery;
- the 9px sideways scroll on the phone loans list;
- truncated payment filters;
- clipped table columns;
- the stretched Day close card;
- raw keys and IDs in the audit log;
- the disappearing PDF footer and the gap on agreement page 1 (R2).

## Live site

- Live testing could not go ahead. The test login stored in this session's environment is rejected ("The email or password is not correct"), even with stray spaces trimmed.
- Changes to environment settings only reach a session when it starts, so this session most likely still has the old values. The live site itself answered normally.
- I stopped after one attempt to stay clear of the 5-failure lockout.
- The deploys themselves are only screen, document and wording changes (no database migrations), so Vercel deploys them from `main` with nothing to run on Supabase.

## Still open / for you

1. **Live test login:** to test on live in a later session, check the email and password saved in the environment and start a new session.
2. **Security housekeeping:** once live access is no longer needed, remove `SUPABASE_DB_URL`, `LIVE_TEST_EMAIL` and `LIVE_TEST_PASSWORD` from the environment settings. You can also reset the database password, since it was stored there.
3. **Phone "Due" tab label:** commit `65e56c5` (the bottom-bar label "Due") is still unpushed, as you asked. Say the word and it goes in.
4. Real company details (address, phones, registration) can be filled in under Settings → Company. Empty fields stay blank on the documents.
