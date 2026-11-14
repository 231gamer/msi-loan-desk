# Backups (Supabase Free plan)

Supabase's Free plan keeps no backups you can download, so LoanDesk makes its own. Every night at
02:17 (Monrovia time), after the 01:00 daily job, a GitHub Actions job (`.github/workflows/backup.yml`,
`scripts/backup-nightly.sh`):

1. dumps the database (everything: customers, loans, the ledger, the audit log and the logins), and
   checks that the dump can be read back;
2. copies the uploaded files (customer photos, ID scans, collateral documents, the logo);
3. **encrypts** both, so only the two key holders, Foday and MSI's CEO, can open them;
4. uploads them to a private **Cloudflare R2** bucket:
   - `daily/YYYY-MM-DD/`, kept 30 days;
   - on the 1st of each month also `monthly/YYYY-MM/`, kept 12 months.

Each night's backup is three files: `…db.dump.age`, `…files.tar.gz.age` and `…SHA256SUMS`.

If a night fails, GitHub emails the person who last changed the workflow file.

## One-time setup (about 30 minutes)

### 1. The two unlock keys (Foday and the CEO, each on their own computer)

A backup can only be opened with one of these keys. **If both are lost, no backup can ever be restored.**

1. Download `age` for Windows from <https://github.com/FiloSottile/age/releases> (the `windows-amd64.zip`) and unzip it.
2. In that folder, open a terminal and run `age-keygen -o loandesk-backup-key.txt`.
3. It prints `Public key: age1…`. **Send only that `age1…` line to Foday.** It is safe to share.
4. The file `loandesk-backup-key.txt` is the private key:
   - keep it on that computer;
   - keep a second copy on a USB stick or on paper, somewhere safe;
   - **never** email, chat, upload or commit it.

### 2. Cloudflare R2 (the storage)

1. Create a Cloudflare account. Cloudflare may ask for a card to turn on R2, even though LoanDesk stays within the free 10 GB.
2. **R2 → Create bucket**: name `msi-loandesk-backups`, location Automatic.
3. Open the bucket → **Settings → Object lifecycle rules** and add two rules:
   - `daily/`: delete objects 30 days after upload.
   - `monthly/`: delete objects 365 days after upload.
4. **R2 → Manage API tokens → Create API token**:
   - permission **Object Read & Write**;
   - **Apply to specific buckets only:** `msi-loandesk-backups`.
5. Copy the **Access Key ID**, the **Secret Access Key** and the **S3 endpoint** (`https://<account-id>.r2.cloudflarestorage.com`).

### 3. Supabase (what to back up)

1. **Connect** (top bar) → **Session pooler** → copy the connection string (URI) and put the database password in it.
   - Use the session pooler: GitHub cannot reach the Free plan's direct connection.
2. **Storage → Settings → S3 Connection**:
   - copy the **Endpoint** and the **Region**;
   - under **S3 Access Keys** create a key named `nightly-backup` and copy its **Access key ID** and **Secret access key**.

### 4. GitHub (where the secrets live)

Repository → **Settings → Secrets and variables → Actions**.

**Secrets** (tab "Secrets"):

| Name | Value |
|---|---|
| `BACKUP_DATABASE_URL` | the session pooler connection string (step 3.1) |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | `msi-loandesk-backups` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | the R2 token (step 2.5) |
| `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION` | from step 3.2 |
| `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY` | the Supabase S3 key (step 3.2) |

**Variables** (tab "Variables"):

| Name | Value |
|---|---|
| `BACKUP_AGE_RECIPIENTS` | both public keys (`age1…`), one per line |
| `BACKUP_ENABLED` | `true` |

These values never go in the repository, in chat, or in a Claude environment.

### 5. First run

1. **Actions → Nightly backup → Run workflow**, and wait for the green tick (about 2 minutes).
2. In R2, check that the bucket has `daily/<today>/` with the three files.

## Restore test (once before go-live, then every quarter)

On the Windows PC, in Git Bash, with Docker running:

1. Download the three files of one night from the R2 bucket.
2. Check them: `sha256sum -c loandesk-*.SHA256SUMS`. Both lines should say `OK`.
3. Open the database dump:
   ```bash
   age -d -i loandesk-backup-key.txt -o loandesk.dump loandesk-*.db.dump.age
   ```
4. Restore it into a scratch database on the local stack:
   ```bash
   pnpm db:start
   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "create database restore_check"
   pg_restore --no-owner --no-privileges -d postgresql://postgres:postgres@127.0.0.1:54322/restore_check loandesk.dump
   ```
   One error is expected and harmless: `schema "public" already exists`.
5. Compare the restored copy with the live system:
   - the number of loans and payments;
   - the trial balance (debits minus credits = 0);
   - the total outstanding.
6. Check the files:
   ```bash
   age -d -i loandesk-backup-key.txt -o files.tar.gz loandesk-*.files.tar.gz.age && tar -tzf files.tar.gz | head
   ```
7. Delete the decrypted copies, and write the date and result in `docs/PROGRESS.md`.

## If the live database is lost

1. Create a new Supabase project.
2. Restore the latest dump into it with `pg_restore`, as above.
3. Upload the files back into the `documents` and `branding` buckets.
4. Point Vercel's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` at the new project, and redeploy (`docs/DEPLOY.md`).

## Good to know

- **What's in a backup:** each one holds borrowers' personal details and the login password hashes. That is why it is encrypted before it leaves GitHub. The R2 token can only reach the one bucket.
- **If a secret leaks:** create a new key in R2 or Supabase, update the GitHub secret, and delete the old key.
- **If a key holder changes:** generate a new key pair and replace their line in `BACKUP_AGE_RECIPIENTS`. Old backups still open only with the old key, so keep it until those backups have expired.
- **Pausing:** Supabase pauses a Free project after a period without activity. Daily use of LoanDesk keeps it awake. If it ever pauses (for example over a long holiday), press **Restore** in the Supabase dashboard.
- **On your PC:** `scripts/backup.sh` still makes an unencrypted dump. Use it only for an extra copy kept encrypted on your own disk.
