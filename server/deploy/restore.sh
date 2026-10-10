#!/usr/bin/env bash
# Puts a backup made by backup.sh back into the database (docs/deploy.md,
# "Restoring a backup"). Run it on the server, from the server/ folder:
#
#   deploy/restore.sh backups/bym-20261010-030000.dump
#       Replaces the live game database with the backup. The game is stopped
#       for the swap and started again afterwards. The database as it was is
#       kept, renamed bym_before_restore_<time>, until you delete it.
#
#   deploy/restore.sh backups/bym-20261010-030000.dump bym_check
#       Restores into a new, separate database (here bym_check) and leaves the
#       game alone: for looking inside a backup, or testing that it restores.
#
# The backup is first restored into a fresh database; the live one is only
# touched once that has worked, so a broken backup file changes nothing.
#
# DB_EXEC is how commands reach the database container. The default is the
# production stack's db service; set it to run against another container,
# e.g. DB_EXEC="docker exec -i bymr-database" for the local dev database.
set -euo pipefail

cd "$(dirname "$0")/.."

compose() { deploy/prod.sh "$@"; }

DB_EXEC="${DB_EXEC:-}"
# A command in the database container reads this script's input unless told
# otherwise, which would swallow the YES typed below; only pg_restore gets it.
in_db() {
  if [ -n "$DB_EXEC" ]; then $DB_EXEC "$@"; else compose exec -T db "$@"; fi
}
# Runs as the container's own superuser (POSTGRES_USER), so no password is needed here.
psql_admin() { in_db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -tAc "$0"' "$1" < /dev/null; }

dump="${1:-}"
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "Usage: deploy/restore.sh <backup file> [database name]" >&2
  echo "Backups are in server/backups/; the newest is: $(ls -1t backups/bym-*.dump 2>/dev/null | head -1)" >&2
  exit 1
fi

live="$(in_db sh -c 'echo "$POSTGRES_DB"' < /dev/null | tr -d '\r')"
target="${2:-$live}"

if ! [[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "A database name may only use a-z, 0-9 and _: $target" >&2
  exit 1
fi

exists() { [ "$(psql_admin "SELECT 1 FROM pg_database WHERE datname = '$1'" | tr -d '\r')" = "1" ]; }

if [ "$target" != "$live" ] && exists "$target"; then
  echo "A database called $target already exists; pick another name." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%d%H%M%S)"
staging="${target}_restoring_${stamp}"

echo "Restoring $dump into a new database, $staging ..."
psql_admin "CREATE DATABASE $staging" >/dev/null
# Until the copy is in place, any way out of this script removes it again.
trap 'psql_admin "DROP DATABASE IF EXISTS $staging" >/dev/null || true' EXIT

if ! in_db sh -c 'pg_restore -U "$POSTGRES_USER" --no-owner --exit-on-error -d "$0"' "$staging" < "$dump"; then
  echo "The backup did not restore; nothing else was changed." >&2
  exit 1
fi

users="$(in_db sh -c 'psql -U "$POSTGRES_USER" -d "$0" -tAc "SELECT count(*) FROM bym.user"' "$staging" < /dev/null | tr -d '\r')"
echo "Restored. The backup holds $users accounts."

if [ "$target" != "$live" ]; then
  psql_admin "ALTER DATABASE $staging RENAME TO $target" >/dev/null
  trap - EXIT
  echo "Done: the backup is in database $target. The game was not touched."
  exit 0
fi

echo
echo "This replaces the LIVE game database ($live) with the backup."
echo "Anything players did after the backup was taken will be lost."
answer=""
read -r -p "Type YES to go ahead: " answer || true
if [ "$answer" != "YES" ]; then
  echo "Stopped; nothing was changed."
  exit 1
fi

old="${live}_before_restore_${stamp}"
if [ -z "$DB_EXEC" ]; then compose stop web; fi
psql_admin "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$live' AND pid <> pg_backend_pid()" >/dev/null
psql_admin "ALTER DATABASE $live RENAME TO $old" >/dev/null
psql_admin "ALTER DATABASE $staging RENAME TO $live" >/dev/null
trap - EXIT
if [ -z "$DB_EXEC" ]; then compose start web; fi

echo "Done. The game runs on the backup now."
echo "The database as it was before is kept as $old. Once you are happy, delete it with:"
echo "  deploy/prod.sh exec db sh -c 'dropdb -U \"\$POSTGRES_USER\" $old'"
