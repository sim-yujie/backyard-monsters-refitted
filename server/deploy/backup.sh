#!/usr/bin/env bash
# Takes one backup of the game database and deletes backups older than
# KEEP_DAYS (docs/deploy.md, "Backups").
#
# The backup service in docker-compose.prod.yml runs this once when it starts
# and then every day at BACKUP_HOUR (UTC). Each backup is one file,
# bym-YYYYMMDD-HHMMSS.dump in pg_dump's compressed "custom" format, which
# restore.sh reads back.
#
# Settings, all from the environment:
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE - the database (libpq's own names)
#   BACKUP_DIR - where the files go (default /backups)
#   KEEP_DAYS  - how many days of backups to keep (default 14)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/bym-$stamp.dump"
partial="$target.partial"

# Written under a .partial name first, so a backup cut short (disk full, the
# database going away) is never mistaken for a good one.
if ! pg_dump --format=custom --compress=6 --file="$partial"; then
  rm -f "$partial"
  echo "$(date -u +%FT%TZ) backup FAILED" >&2
  exit 1
fi
mv "$partial" "$target"

echo "$(date -u +%FT%TZ) backup written: $target ($(du -h "$target" | cut -f1))"

# Old backups, and any .partial a crash left behind.
find "$BACKUP_DIR" -maxdepth 1 -name 'bym-*.dump*' -mtime "+$((KEEP_DAYS - 1))" -print -delete
