#!/usr/bin/env bash
# Runs database commands against the HOSTED (live) Supabase project without `supabase login` or `link`.
# See docs/OPERATIONS.md section 3 ("Deploying").
#
# Usage (Git Bash or Linux, from the project folder):
#   scripts/hosted-db.sh migrations          list local vs. hosted migrations
#   scripts/hosted-db.sh push                apply new migrations (never seeds)
#   scripts/hosted-db.sh advisors            Supabase security advisor (level warn)
#   scripts/hosted-db.sh psql [args] < f.sql psql session (needs Docker and the local Supabase Postgres image)
#
# Reads the connection from an ignored env file: HOSTED_ENV_FILE, else .env.hosted, else .env.staging.
# The file needs SUPABASE_DB_URL (Supabase → Connect → Session pooler URI, password filled in). The
# password is URL-encoded in memory, Windows line endings are ignored, and the URL is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

env_file="${HOSTED_ENV_FILE:-}"
if [[ -z "$env_file" ]]; then
  for f in .env.hosted .env.staging; do [[ -f "$f" ]] && { env_file="$f"; break; }; done
fi
[[ -n "$env_file" && -f "$env_file" ]] || { echo "No env file: create .env.hosted with SUPABASE_DB_URL=..." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. <(tr -d '\r' < "$env_file")
set +a
[[ -n "${SUPABASE_DB_URL:-}" ]] || { echo "SUPABASE_DB_URL is empty in $env_file" >&2; exit 1; }

db_url="$(node -e '
const u = process.env.SUPABASE_DB_URL;
const m = u.match(/^(postgres(?:ql)?:\/\/[^:]+:)(.*)(@[^@\/]+\/.*)$/);
if (!m) { console.error("SUPABASE_DB_URL is not postgresql://user:password@host:port/db"); process.exit(1); }
process.stdout.write(m[1] + encodeURIComponent(m[2]) + m[3]);')"

hide() { sed -E 's#postgres(ql)?://[^ "]+#<db-url>#g'; }
cli() { node node_modules/supabase/dist/supabase.js "$@" 2>&1 | grep -v -E 'deprecated|new version of Supabase CLI|recommend updating' | hide; }

cmd="${1:-}"; shift || true
case "$cmd" in
  migrations) cli migration list --db-url "$db_url" ;;
  push)       cli db push --yes --db-url "$db_url" ;;
  advisors)   cli db advisors --type security --level warn --db-url "$db_url" ;;
  psql)
    image="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -m1 'supabase/postgres:' || true)"
    [[ -n "$image" ]] || { echo "No supabase/postgres image: run 'pnpm db:start' once to pull it." >&2; exit 1; }
    sep='?'; [[ "$db_url" == *\?* ]] && sep='&'
    PGURL="${db_url}${sep}sslmode=require" MSYS_NO_PATHCONV=1 \
      docker run --rm -i -e PGURL --entrypoint sh "$image" -c 'psql "$PGURL" -X -v ON_ERROR_STOP=1 "$@"' psql "$@" 2>&1 | hide ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
