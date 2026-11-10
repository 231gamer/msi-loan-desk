# Prompt for the next Claude Code session

Paste the text below as the first message of a new session in the project folder (or a clone of `231gamer/msi-loan-desk`). Add what you want done in that session at the end.

---

You are continuing LoanDesk, the loan management system for Method Solutions Inc. (MSI). Phases M0 to M9 are built, and the system is **live** at https://www.methodsolutionslr.com (Vercel project `msi-loan-desk`, Supabase project `msi-loandesk`, marked production, free plan). The code is in the private GitHub repository `231gamer/msi-loan-desk`; `main` is what runs live.

**Status:** hosted setup done on 2026-11-09 (see "Hosted setup" in `docs/PROGRESS.md`). Next comes the client pilot gate (SPEC 13) and going live with real data (`docs/OPERATIONS.md` section 4). First run `git status -sb`, `git fetch` and `git log --oneline -5 origin/main`, and check `https://www.methodsolutionslr.com/api/health`. I will answer the open questions later; until then use the recommended defaults in `docs/reports/OPEN-QUESTIONS-2026-11-05.md` and `docs/QUESTIONS.md`. Do not build B-19 (WhatsApp share on receipts) until I approve it.

**Before you write code:**
1. Read `CLAUDE.md` and follow it exactly. Its rules override defaults.
2. Read `docs/PROGRESS.md`: its state, the hosted setup and its open items, and the session start checklist (item 8 covers my Windows PC). Then follow the checklist: Docker Desktop and local Supabase, install, write `.env.local`, and run the checks.
3. Read `docs/OPERATIONS.md` (sections 1 and 3: the live environment and how to deploy), `docs/DECISIONS.md` (latest rows) and the SPEC sections for the work.
4. `docs/SPEC.md` is the single source of truth (SPEC > DEMO_DATA > mock-ups > prompt). If code and spec disagree, stop and ask.

**How to work:**
- Keep chat output short: report block results, blockers and decisions only.
- **Never push to `main`: Vercel deploys it to the live site.** Work on a branch, push it, and give me the link to open the pull request (the `gh` CLI is not installed). I merge after approval; that merge is the deploy.
- If the change has migrations, after my merge run `scripts/hosted-db.sh migrations`, then `push`, then `advisors`, and check `/api/health`. Ask before any migration that changes or deletes existing data, and take a backup first.
- Never run `pnpm seed:demo` or any test against the live database. Test locally (`pnpm db:start`).
- Live secrets are in the ignored `.env.staging` file on my PC. Never print, paste or commit them.
- Write a short block plan into `docs/PROGRESS.md`, then build block by block; after each block run every check, commit with a Conventional Commit message and push.
- Stop and ask first for "ask first" items: money rules beyond the spec, schema or RPC contracts beyond the spec, security or permission changes, user-visible mock-up deviations, new scope, cost, or anything irreversible.
- At the end: run every check (including `pnpm test:smoke`), update the changelog and the progress log, then STOP and wait for my approval.

---
