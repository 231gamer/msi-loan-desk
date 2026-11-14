# Operations

How LoanDesk runs day to day, how it is deployed and backed up, and what to do when something goes wrong. For the rules behind each step, see `docs/SPEC.md`; for decisions, `docs/DECISIONS.md`.

## 1. What runs where

| Part | Where | Notes |
| --- | --- | --- |
| Web app (Next.js) | Vercel | Server components and server actions; the browser talks only to the app |
| Database, auth, files | Supabase (Pro, for daily backups) | Postgres 17, RLS on every table, private `documents` bucket, public `branding` bucket |
| Daily job | Supabase `pg_cron`, job `daily-accruals`, 01:00 UTC (= Monrovia) | Overdue marking, weekly penalties, recovery flags (SPEC 5.5) |
| Health check | `GET /api/health` | `{"status":"ok","database":"ok","lastAccrualRun":…}`; HTTP 503 when the database does not answer |

### The live environment (set up 2026-11-09)

| Part | Value |
| --- | --- |
| Address for staff | https://www.methodsolutionslr.com (`methodsolutionslr.com` redirects there; `msi-loan-desk.vercel.app` also works) |
| Code | GitHub `231gamer/msi-loan-desk` (private), branch `main` |
| Web app | Vercel project `msi-loan-desk`; every push to `main` deploys to production |
| Database | Supabase project `msi-loandesk`, ref `nvtakgkiuasuywxgjaay`, region eu-west-1 (Ireland), **free plan** (no backups, pauses when idle: upgrade to Pro before real use). `app_environment` = `production` |
| Admin | Corex-admin (Foday's email) |
| Secrets | Supabase and Vercel dashboards, Foday's password manager, and the ignored `.env.staging` on Foday's PC (`SUPABASE_DB_URL`, URL, anon and service role keys). Never in the repository or chat |

There is no separate staging project: the project first created as staging was switched to production on 2026-11-09. Test risky changes locally (`pnpm db:start`, demo seed) before merging.

## 2. Environment variables

Set in Vercel (Production and Preview) and in `.env.local` for development (`pnpm env:local` writes the local values).

| Variable | Where it is used | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server | No (protected by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only: creating users, password resets, sign-in lockout | **Yes**: never in client code, logs or the repository |

`DATABASE_URL` is used only by `scripts/backup.sh` on the machine that takes backups; it is not set in Vercel.

## 3. Deploying

1. Work on a branch and open a pull request into `main`. CI must be green (lint, types, unit, database tests, e2e, `pnpm audit`). Never push to `main` directly: Vercel deploys it to the live site at once.
2. Foday approves and merges. Vercel builds `main` and the new version is live in about 2 minutes.
3. If the pull request adds migrations, apply them to the live database right after the merge (the new code may need them):
   ```bash
   scripts/hosted-db.sh migrations   # shows which are not applied yet
   scripts/hosted-db.sh push         # applies them; never seeds
   scripts/hosted-db.sh advisors     # security advisor must stay clean
   ```
   The script reads `SUPABASE_DB_URL` from the ignored `.env.hosted` or `.env.staging` file (no `supabase login` or `link` needed). The alternative is `pnpm supabase link --project-ref <ref>` once, then `pnpm supabase db push`. Migrations are append-only; never edit one that is already in production. Take a backup (section 6) before a migration that changes or moves data.
4. Check `/api/health` afterwards. After a migration that adds RPCs, regenerate types locally (`pnpm types`) and commit them.
5. To undo a bad deploy: Vercel → Deployments → the previous one → **Promote to Production** (instant). Database changes are not undone by this; fix them with a new migration.

Never run `pnpm seed:demo` against production. Demo data belongs in the demo project only.

## 4. Going live (FR-27, A-19)

1. **Before go-live**:
   - The admin creates users, branches, products and the company header in Settings.
   - The accountant enters **opening balances** (Ledger → Opening balances): cash per branch, bank, mobile money, amounts owed to payees, owner's capital. The difference goes to 3900 Opening Balance Equity.
   - **Old loans** are entered as loans (customer, loan, approval, payout dated the original day), and their payments are dated the day they were received. Only admin and accountant may back-date, and only before go-live.
2. Check the trial balance and balance sheet (Reports) against the paper books; both must show the green check.
3. The admin sets **Settings → go-live date**. From that day every entry is dated today (`DATE_NOT_ALLOWED` otherwise), and opening balances can no longer be entered.
4. Take a backup (section 6) and keep it as the go-live copy.

## 5. Daily routine

| Who | What | Where |
| --- | --- | --- |
| Loan officers | Collect in the field; hand the cash to the cashier the same day | `/field`, cashier confirms on `/remittance` |
| Cashier | Receive payments, pay out approved loans, confirm field cash; at the end of the day count the drawer and close the day | `/payments/new`, `/remittance`, `/day-close` |
| Manager | Approve requests, review the day close (approving locks the day), follow overdue loans and recovery | `/approvals`, `/day-close`, `/due`, `/recovery` |
| Accountant | Expenses, payees, reports, month-end checks | `/expenses`, `/reports` |
| System | Daily job at 01:00 | Check "Last daily job" on the admin dashboard, or `/api/health` |

If the daily job did not run (for example the database was paused), a manager or the admin opens `/due` and presses **Run the daily job now**. A late run charges the same penalties as on-time runs (T-33).

## 6. Backups and restore (SPEC 11)

- **Nightly (automatic)**: LoanDesk runs on the Supabase Free plan, which keeps no downloadable backups. A GitHub Actions job backs up the database and the uploaded files every night at 02:17, encrypted, to Cloudflare R2. Daily copies are kept 30 days and monthly copies 12 months. Setup, restore and recovery steps are in `docs/BACKUPS.md`.
- **Extra copy on your PC (optional)**:
  ```bash
  DATABASE_URL='postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres' scripts/backup.sh /secure/backups
  ```
  - The script writes `loandesk-<timestamp>.dump` and a `.sha256` file next to it, and keeps the latest 8 dumps (`KEEP=` changes that).
  - Store the folder encrypted, outside Supabase.
  - The dump includes the `auth` and `storage` schemas, but not the file contents: the files are in the Storage bucket. To copy the files too, run `supabase storage cp` (or download them from the Dashboard) as well.
- **Restore test (once before go-live, then every quarter)**:
  1. Create an empty Supabase project, or a local stack: `pnpm db:start`.
  2. Restore the dump: `pg_restore --no-owner --no-privileges --dbname "$TARGET_URL" loandesk-<timestamp>.dump`.
  3. Check the restore:
     - the trial balance balances;
     - the loan count and the total outstanding match production;
     - `/api/health` on that copy answers.
  4. Note the date and the result in `docs/PROGRESS.md`.

## 7. Security

- **Sign-in**:
  - passwords have at least 10 characters, and sessions end after 12 hours;
  - 5 failed attempts lock an account for 15 minutes, on top of Supabase's per-IP limits;
  - an admin resets passwords in Settings.
- **Roles**: every money action and permission is checked in Postgres. The UI checks are only for comfort. RLS is on every table, and a database test fails if a table is added without RLS.
- **Headers**: CSP (only this site's own scripts, styles and images, plus Supabase for images; no framing), HSTS, `nosniff`, a strict referrer policy and a permissions policy.
- **If a key leaks**: rotate it in Supabase (Settings → API) and update Vercel. After rotating the JWT secret, everyone signs in again.
- **Leavers**: the admin deactivates the user in Settings. Their records and audit history stay.

## 8. When something goes wrong

| Situation | What to do |
| --- | --- |
| A payment arrives for a day that is already closed | A manager reopens the day with a reason (`/day-close` → Reopen day). The cashier records the payment and closes the day again |
| A payment was recorded wrongly | The cashier asks for a void with a reason (`/payments`). A different manager approves, and the receipt prints VOID. Nothing is ever deleted |
| A journal is wrong | The accountant asks for a reversal or a manual journal. A manager approves |
| A report shows the red "does not balance" banner | Stop month-end work and tell the developer. This should never happen: every journal is checked to balance when it is posted |
| `/api/health` returns 503 | Check the Supabase status page and the project's dashboard (is the project paused, or are connections exhausted?) |
| Server errors | Vercel logs show `{"level":"error","code":…,"where":…,"userId":…}`. Logs never contain names, phones or amounts |

## 9. Demo environment

- **Separate project**: the demo runs on its own Supabase project and Vercel project. `pnpm seed:demo --as-of 2026-02-12` fills it with the data in `docs/DEMO_DATA.md`.
- **Passwords**: the seed prints the passwords once. Store them in the password manager; they are never committed.
- **Check**: `DEMO_GRACE_PASSWORD=… pnpm test:demo` runs the scripted payment against a freshly seeded demo.
