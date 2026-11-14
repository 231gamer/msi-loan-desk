#!/usr/bin/env bash
# Nightly encrypted backup to Cloudflare R2 (docs/BACKUPS.md). Run by .github/workflows/backup.yml.
#
# 1. Dumps the database (scripts/backup.sh: public, auth and storage schemas) and checks the dump
#    can be read back.
# 2. Copies the uploaded files (Supabase Storage buckets) through Supabase's S3 endpoint.
# 3. Encrypts both with age for every public key in BACKUP_AGE_RECIPIENTS (Foday and MSI's CEO):
#    only the holders of the matching private keys can open them.
# 4. Uploads them to R2 under daily/YYYY-MM-DD/, and on the 1st of the month also under
#    monthly/YYYY-MM/ (R2 lifecycle rules delete daily/ after 30 days, monthly/ after 365).
#
# Required environment (GitHub Actions secrets; never commit or print them):
#   DATABASE_URL                     Supabase "Session pooler" connection string
#   BACKUP_AGE_RECIPIENTS            age public keys, one per line (age1...)
#   R2_ENDPOINT, R2_BUCKET           https://<account-id>.r2.cloudflarestorage.com and the bucket
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
#   SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY
# Optional: FILE_BUCKETS (default "documents branding"), BACKUP_DATE (YYYY-MM-DD, default today UTC).
set -euo pipefail

for name in DATABASE_URL BACKUP_AGE_RECIPIENTS R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY \
  SUPABASE_S3_ENDPOINT SUPABASE_S3_REGION SUPABASE_S3_ACCESS_KEY_ID SUPABASE_S3_SECRET_ACCESS_KEY; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing setting: $name (see docs/BACKUPS.md)." >&2
    exit 1
  fi
done
for tool in pg_dump pg_restore age aws tar sha256sum; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done

umask 077
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
here="$(cd "$(dirname "$0")" && pwd)"
day="${BACKUP_DATE:-$(date -u +%F)}"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"

# Runs aws against R2 or Supabase with that side's keys only.
r2() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION=auto aws --endpoint-url "$R2_ENDPOINT" "$@"
}
supa() {
  AWS_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="$SUPABASE_S3_REGION" aws --endpoint-url "$SUPABASE_S3_ENDPOINT" "$@"
}

printf '%s\n' "$BACKUP_AGE_RECIPIENTS" | grep -E '^age1[0-9a-z]+$' > "$work/recipients.txt" || true
if [[ ! -s "$work/recipients.txt" ]]; then
  echo "BACKUP_AGE_RECIPIENTS holds no age public key (age1...)." >&2
  exit 1
fi
echo "Encrypting for $(wc -l < "$work/recipients.txt") key holder(s)."

# 1. Database.
KEEP=1 bash "$here/backup.sh" "$work/db" >/dev/null
dump="$(ls -1 "$work"/db/loandesk-*.dump)"
pg_restore --list "$dump" > "$work/toc.txt"
grep -q "TABLE DATA public journal_lines" "$work/toc.txt" || {
  echo "The dump has no journal_lines data: refusing to upload an incomplete backup." >&2
  exit 1
}
echo "Database dump: $(du -h "$dump" | cut -f1), $(grep -c "TABLE DATA" "$work/toc.txt") tables with data."

# 2. Uploaded files.
mkdir -p "$work/files"
for bucket in ${FILE_BUCKETS:-documents branding}; do
  supa s3 sync "s3://$bucket" "$work/files/$bucket" --only-show-errors
done
file_count="$(find "$work/files" -type f | wc -l)"
tar -C "$work/files" -czf "$work/files.tar.gz" .
echo "Files: $file_count."

# 3. Encrypt, under the names they are uploaded with (so SHA256SUMS checks the downloaded copies).
name="loandesk-$stamp"
age --encrypt -R "$work/recipients.txt" -o "$work/$name.db.dump.age" "$dump"
age --encrypt -R "$work/recipients.txt" -o "$work/$name.files.tar.gz.age" "$work/files.tar.gz"
(cd "$work" && sha256sum "$name.db.dump.age" "$name.files.tar.gz.age" > "$name.SHA256SUMS")

# 4. Upload, then confirm each file is there.
targets=("daily/$day")
[[ "${day:8:2}" == "01" ]] && targets+=("monthly/${day:0:7}")
for prefix in "${targets[@]}"; do
  for file in "$name.db.dump.age" "$name.files.tar.gz.age" "$name.SHA256SUMS"; do
    r2 s3 cp "$work/$file" "s3://$R2_BUCKET/$prefix/$file" --only-show-errors
    r2 s3 ls "s3://$R2_BUCKET/$prefix/$file" >/dev/null
  done
  echo "Uploaded to $prefix/"
done
echo "Backup complete: $stamp"
