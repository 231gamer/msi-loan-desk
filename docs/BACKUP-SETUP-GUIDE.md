# Backup setup guide, step by step (for beginners)

This guide sets up everything LoanDesk's nightly backup needs: the place where backups are stored (a Cloudflare R2 bucket), the keys that let GitHub write there, and the two connection details from Supabase. You don't need to know any programming.

**Time needed:** about 30 to 40 minutes.
**You need:** a computer with a web browser, the email address you want to use for Cloudflare, and your Supabase login.

When you finish, you will have **nine values** to paste into GitHub (Part D). Most of them are shown **only once**, so follow the "Keep this safe" notes.

---

## Before you start: where to keep the values

Several of the values you create are passwords. Anyone who has them could read or delete MSI's backups.

- **Best:** a password manager (Bitwarden is free, or 1Password). Make one entry called "LoanDesk backups" and paste each value into it as you go.
- **Never:** email, WhatsApp, chat (including Claude), a shared document, or a file inside the LoanDesk project.
- When Part D is finished, the values only need to live in GitHub and your password manager.

Copy this checklist into your password manager entry and fill it in as you go:

```
R2_ENDPOINT                      = https://________________________________.r2.cloudflarestorage.com
R2_BUCKET                        = msi-loandesk-backups
R2_ACCESS_KEY_ID                 = ________________________________
R2_SECRET_ACCESS_KEY             = ________________________________
BACKUP_DATABASE_URL              = postgresql://postgres.________:________@________.pooler.supabase.com:5432/postgres
SUPABASE_S3_ENDPOINT             = https://________________.storage.supabase.co/storage/v1/s3
SUPABASE_S3_REGION               = ________________
SUPABASE_S3_ACCESS_KEY_ID        = ________________________________
SUPABASE_S3_SECRET_ACCESS_KEY    = ________________________________
```

> Websites change their buttons from time to time. If a button in this guide has a slightly different name, look for the closest match. The steps stay the same.

---

## Part A. Cloudflare account and the R2 bucket

**What is this?** Cloudflare R2 is online storage, like a private Google Drive for files that programs upload. A **bucket** is one storage folder. LoanDesk's backups go into a bucket that only the backup job can reach.

### A1. Create a Cloudflare account (skip if you have one)

1. Open **https://dash.cloudflare.com/sign-up** in your browser.
2. Enter your email address and a strong password, then click **Sign up**.
3. Open the email Cloudflare sends you and click the **verify** link.
4. Sign in at **https://dash.cloudflare.com**.

### A2. Turn on R2

1. In the left menu, click **R2 Object Storage**. If you don't see it, use the search box at the top and type `R2`.
2. If Cloudflare asks you to **purchase R2** or **add a payment method**, follow the steps. R2 has a free allowance (10 GB of storage each month), and LoanDesk's backups stay far below it, so you should not be charged. Cloudflare still asks for a card before switching R2 on.
3. When it's done, you see the **R2 Overview** page.

### A3. Create the bucket

1. On the R2 Overview page, click **Create bucket**.
2. **Bucket name:** type `msi-loandesk-backups` (lowercase, with the dashes).
3. **Location:** leave it on **Automatic**.
4. **Default storage class:** leave it on **Standard**.
5. Click **Create bucket**.
6. You are now inside the empty bucket.

**Fill in your checklist:** `R2_BUCKET = msi-loandesk-backups`

> Do **not** turn on "Public access" or a custom domain for this bucket. It must stay private.

### A4. Make old backups delete themselves (lifecycle rules)

Without this, backups would pile up forever. You will add two rules: daily backups are kept 30 days, monthly backups 365 days.

1. Inside the bucket, click the **Settings** tab.
2. Scroll down to **Object lifecycle rules** and click **Add rule**.
3. Fill in the first rule:
   - **Rule name:** `delete-daily-after-30-days`
   - **Apply to:** choose the option for a **prefix**, and type `daily/` (with the slash at the end).
   - **Action:** **Delete uploaded objects** after **30** days.
   - Click **Add rule** (or **Save**).
4. Click **Add rule** again for the second rule:
   - **Rule name:** `delete-monthly-after-365-days`
   - **Prefix:** `monthly/`
   - **Action:** **Delete uploaded objects** after **365** days.
   - Save it.
5. You should now see both rules listed.

> If there is already a default rule about "incomplete multipart uploads", leave it. It's harmless.

### A5. Find your R2 endpoint (the bucket's address)

1. Go back to **R2 Object Storage → Overview**.
2. On the right side, find **Account details** (or **Account ID**). Copy the **Account ID**, a long mix of letters and numbers.
3. Your endpoint is that ID placed inside this address:
   `https://<ACCOUNT-ID>.r2.cloudflarestorage.com`
   For example, with Account ID `3f2a…9b`: `https://3f2a…9b.r2.cloudflarestorage.com`
4. You will also see this full address on the screen in step A6.

**Fill in your checklist:** `R2_ENDPOINT = https://<your account id>.r2.cloudflarestorage.com`

### A6. Create the R2 access key (an API token for this bucket only)

**What is this?** A username and password that let the backup job upload into **this one bucket only**. If it ever leaked, nothing else in your Cloudflare account would be exposed.

1. Go to **R2 Object Storage → Overview**.
2. Click **Manage API tokens**. It may be under the **{} API** button or on the right side.
3. Click **Create Account API token** (if you only see **Create API token**, use that).
4. Fill in the form:
   - **Token name:** `loandesk-nightly-backup`
   - **Permissions:** **Object Read & Write**. Do **not** choose "Admin".
   - **Specify bucket(s):** choose **Apply to specific buckets only**, then select `msi-loandesk-backups`.
   - **TTL** (how long the token works): **Forever**.
   - **Client IP address filtering:** leave empty.
5. Click **Create API token** (or **Create Account API token**).
6. The next screen shows the values **only once**. Copy each one into your password manager **now**:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   - **Default endpoint for S3 clients** (`https://….r2.cloudflarestorage.com`) → check it matches your `R2_ENDPOINT`
   - The **Token value** at the top isn't needed.
7. Click **Finish** only after all of these are saved.

> **Lost the secret?** You can't see it again. Delete the token (Manage API tokens → the token → Delete) and create a new one with the same steps.

**Part A is done.** You have `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

---

## Part B. Supabase database connection (the "Session pooler" string)

**What is this?** A single line of text with the address of LoanDesk's database plus its password. The backup job uses it to make the copy. It has to be the **Session pooler** version, because GitHub cannot reach the other kind on Supabase's free plan.

### B1. Open the connection screen

1. Go to **https://supabase.com/dashboard** and sign in.
2. Click the project **msi-loandesk**.
3. At the top of the page, click **Connect** (the button with the plug icon, next to the project name).
4. A window opens with connection options.

### B2. Copy the Session pooler string

1. In the window, find the **Connection string** section (it may be the first tab).
2. Set **Type** to **URI**.
3. Look for the box titled **Session pooler**. Not "Direct connection", and not "Transaction pooler".
   - If you only see a **Method** dropdown, choose **Session pooler** there.
4. Copy the line. It looks like this:
   `postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
   - It starts with `postgres.` followed by your project reference.
   - It ends in `pooler.supabase.com:5432/postgres`, and the number must be **5432**.
5. Paste it into your password manager.

### B3. Put the database password into the string

The copied line has the placeholder `[YOUR-PASSWORD]`. Replace it, **including the square brackets**, with your database password.

- **Do you know the database password?** It's the one you chose when you created the Supabase project. It's different from your Supabase login password. Put it in place of `[YOUR-PASSWORD]`.
- **You don't know it?** Set a new one:
  1. Left menu → **Project Settings** (the gear icon) → **Database**.
  2. Click **Reset database password**.
  3. Click **Generate a password** (or type your own of **letters and numbers only**: no `@`, `:`, `/`, `#`, `%` or spaces, because those break the connection line).
  4. Copy the new password, save it in your password manager, and confirm.
  5. Put it into the line in place of `[YOUR-PASSWORD]`.

  Resetting it does **not** affect the LoanDesk website, which uses separate keys. It only affects tools that use the database password directly, such as `.env.staging` on your PC. Update the password there too.

The final line looks like this (made-up example):
`postgresql://postgres.abcdefghijklmnop:Xk7pQ2mL9vR4tW8z@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`

**Fill in your checklist:** `BACKUP_DATABASE_URL = <the full line, with the password>`

---

## Part C. Supabase storage access key (for the uploaded files)

**What is this?** The database copy doesn't include the uploaded files (customer photos, ID scans, collateral documents, logo). This key lets the backup job download those files to include them.

### C1. Open the storage settings

1. In the Supabase project, click **Storage** in the left menu.
2. At the top of the Files page you see three tabs: **Buckets**, **Settings**, **Policies**. Click **Settings**.

### C2. Turn on the S3 connection and copy the address

1. Find the section **S3 Connection** (or "S3 protocol").
2. Make sure **Enable connection via S3 protocol** is **on**. If you switch it on, click **Save**.
3. Copy the **Endpoint**. It looks like this:
   `https://abcdefghijklmnop.storage.supabase.co/storage/v1/s3`
   → `SUPABASE_S3_ENDPOINT`
4. Copy the **Region**, for example `eu-central-1`.
   → `SUPABASE_S3_REGION`

### C3. Create the access key

1. On the same page, find **S3 Access Keys** and click **New access key**.
2. **Description:** `loandesk-nightly-backup`
3. Click **Create access key**.
4. The values are shown **only once**. Copy both now:
   - **Access key ID** → `SUPABASE_S3_ACCESS_KEY_ID`
   - **Secret access key** → `SUPABASE_S3_SECRET_ACCESS_KEY`
5. Click **Done** only after both are saved.

> This key can read and change **all** stored files, so treat it like a password. If it ever leaks, delete it on this page and create a new one.

**Parts A to C are done.** All nine values in your checklist should now be filled in.

---

## Part D. Put the nine values into GitHub

GitHub keeps them encrypted, and they are never shown again, not even to you.

1. Go to **https://github.com/231gamer/msi-loan-desk** and sign in.
2. Click **Settings** (top right of the repository; you need to be the owner).
3. In the left menu: **Secrets and variables → Actions**.
4. Stay on the **Secrets** tab. For **each** of the nine lines in your checklist:
   1. Click **New repository secret**.
   2. **Name:** the name in capitals, exactly as written (for example `R2_ACCESS_KEY_ID`).
   3. **Secret:** paste the value, with no extra spaces before or after.
   4. Click **Add secret**.
5. When you're done, the Secrets list should show these nine names:
   `BACKUP_DATABASE_URL`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`

> **A typing mistake in a name?** The backup reports "Missing setting: …" with that name. Delete the wrongly named secret and add it again.

### Still to do after this guide

These steps are in `docs/BACKUPS.md`:

1. **The two unlock keys** (yours and the CEO's), section 1. Their public `age1…` lines go into a **variable** (the **Variables** tab, next to Secrets), named `BACKUP_AGE_RECIPIENTS`, with one key per line.
2. **Switch it on:** add the variable `BACKUP_ENABLED` with the value `true`.
3. **First run:** **Actions** tab → **Nightly backup** → **Run workflow**. After about 2 minutes you should see a green tick, and in Cloudflare the bucket now has a `daily/<today's date>/` folder with three files.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| The backup says `Missing setting: R2_…` (or another name) | That secret is missing or misspelled in GitHub | Check the name in Part D, delete it and add it again |
| `password authentication failed` | The password in `BACKUP_DATABASE_URL` is wrong | Redo B3 (reset the password if needed) and update the secret |
| `could not translate host name` or a timeout connecting to the database | The Direct connection or Transaction pooler string was copied | Copy the **Session pooler** line again (port **5432**) |
| `Access Denied` when uploading to R2 | The R2 token isn't allowed on this bucket, or the key was pasted wrongly | Redo A6 with **Object Read & Write** and **this bucket only** |
| `InvalidAccessKeyId` or `SignatureDoesNotMatch` | An access key or secret has a typo or extra space | Paste the values again in GitHub |
| A Supabase storage error | The S3 connection is off, or the region is wrong | Redo C2 (switch it on, copy the region exactly) |
| The job doesn't run at all | `BACKUP_ENABLED` is not `true` | Add the variable (see "Still to do") |

If you get stuck, copy the **red error line** from the GitHub Actions run (Actions → Nightly backup → the failed run → Back up). Send me that line only, never a secret value.
