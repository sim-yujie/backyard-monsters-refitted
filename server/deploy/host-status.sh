#!/usr/bin/env bash
# Writes what the game server cannot see from inside its container into one
# small file, status/host.json, for the owner's dashboard and the Telegram
# alerts (docs/design/admin-dashboard-api.md, "Health"; docs/alerts.md).
#
# Runs on the server itself (not in a container), once a minute, from the
# systemd timer deploy/bymr-host-status.timer. The game server reads the file
# through a read-only mount (docker-compose.prod.yml, `./status`), so it never
# needs the Docker socket or the backups folder.
#
# What it records:
#   - the machine's memory, load and uptime (/proc);
#   - free space on the disks that hold the game folder and Docker's data;
#   - each game container's state, health, restart count and start time;
#   - the newest database backup in backups/ (time, size), how many there are.
#
# Settings, all optional, from the environment:
#   SERVER_DIR      - the game's server folder (default: this script's parent)
#   STATUS_DIR      - where host.json goes (default SERVER_DIR/status)
#   BACKUP_DIR      - the backups folder (default SERVER_DIR/backups)
#   COMPOSE_PROJECT - the Compose project name (default bymr)
#
# It only reads; the one file it writes is replaced in one step, so the game
# server never sees half of it. `bash deploy/host-status.sh --print` writes
# nothing and prints the JSON instead.
set -euo pipefail
umask 022

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="${SERVER_DIR:-$(dirname "$script_dir")}"
STATUS_DIR="${STATUS_DIR:-$SERVER_DIR/status}"
BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-bymr}"

# A JSON string: backslashes and quotes escaped, control characters dropped.
json_str() {
  local s="${1//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="$(printf '%s' "$s" | tr -d '\000-\037')"
  printf '"%s"' "$s"
}

# A whole number, or null when it is not one.
json_int() {
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then printf '%s' "$1"; else printf 'null'; fi
}

# A decimal number, or null when it is not one.
json_num() {
  if [[ "${1:-}" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then printf '%s' "$1"; else printf 'null'; fi
}

meminfo() { awk -v key="$1:" '$1 == key { print $2 * 1024; exit }' /proc/meminfo; }

memory_json() {
  printf '{"totalBytes":%s,"availableBytes":%s,"swapTotalBytes":%s,"swapFreeBytes":%s}' \
    "$(json_int "$(meminfo MemTotal)")" "$(json_int "$(meminfo MemAvailable)")" \
    "$(json_int "$(meminfo SwapTotal)")" "$(json_int "$(meminfo SwapFree)")"
}

load_json() {
  local one five fifteen _rest
  read -r one five fifteen _rest < /proc/loadavg
  printf '[%s,%s,%s]' "$(json_num "$one")" "$(json_num "$five")" "$(json_num "$fifteen")"
}

uptime_seconds() {
  local up _idle
  read -r up _idle < /proc/uptime
  printf '%s' "${up%%.*}"
}

# One entry per disk (not per folder): the game folder and Docker's data are
# usually on the same disk, and it is listed once.
disks_json() {
  local paths=("$SERVER_DIR") docker_root seen="" first=1 path dev size used avail _pct mount
  docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  [ -n "$docker_root" ] && [ -d "$docker_root" ] && paths+=("$docker_root")
  printf '['
  for path in "${paths[@]}"; do
    read -r dev size used avail _pct mount < <(df -P -B1 "$path" | awk 'NR == 2')
    case " $seen " in *" $dev "*) continue ;; esac
    seen="$seen $dev"
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '{"path":%s,"mount":%s,"totalBytes":%s,"usedBytes":%s,"availableBytes":%s}' \
      "$(json_str "$path")" "$(json_str "$mount")" "$(json_int "$size")" "$(json_int "$used")" "$(json_int "$avail")"
  done
  printf ']'
}

# Each container of the Compose project, running or not.
containers_json() {
  local ids line first=1 service status health restarts started oom code
  if ! ids="$(docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" 2>/dev/null)"; then
    printf 'null'
    return
  fi
  printf '['
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086 # one argument per container id
    while IFS='|' read -r service status health restarts started oom code; do
      [ "$first" -eq 1 ] || printf ','
      first=0
      printf '{"service":%s,"state":%s,"health":%s,"restartCount":%s,"startedAt":%s,"oomKilled":%s,"exitCode":%s}' \
        "$(json_str "$service")" "$(json_str "$status")" \
        "$(if [ -n "$health" ]; then json_str "$health"; else printf 'null'; fi)" \
        "$(json_int "$restarts")" "$(json_str "$started")" \
        "$(if [ "$oom" = "true" ]; then printf 'true'; else printf 'false'; fi)" "$(json_int "$code")"
    done < <(docker inspect --format \
      '{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.StartedAt}}|{{.State.OOMKilled}}|{{.State.ExitCode}}' \
      $ids 2>/dev/null)
  fi
  printf ']'
}

# The newest finished backup, how many there are, and any cut-short ones.
backups_json() {
  local count=0 total=0 newest_time="" newest_size="" newest_name="" partial=0 mtime size name
  if [ ! -d "$BACKUP_DIR" ]; then
    printf '{"dir":%s,"found":false}' "$(json_str "$BACKUP_DIR")"
    return
  fi
  while read -r mtime size name; do
    count=$((count + 1))
    total=$((total + size))
    newest_time="${mtime%%.*}" newest_size="$size" newest_name="$name"
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'bym-*.dump' -printf '%T@ %s %f\n' | sort -n)
  partial="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'bym-*.dump.partial' | wc -l)"
  printf '{"dir":%s,"found":true,"count":%s,"totalBytes":%s,"partialCount":%s,"newest":' \
    "$(json_str "$BACKUP_DIR")" "$count" "$total" "$(json_int "${partial// /}")"
  if [ "$count" -gt 0 ]; then
    printf '{"name":%s,"modifiedAt":%s,"sizeBytes":%s}}' \
      "$(json_str "$newest_name")" "$(json_int "$newest_time")" "$(json_int "$newest_size")"
  else
    printf 'null}'
  fi
}

status_json() {
  printf '{"version":1,"generatedAt":%s,"hostname":%s,"uptimeSeconds":%s,"load":%s,"memory":%s,"disks":%s,"containers":%s,"backups":%s}\n' \
    "$(date -u +%s)" "$(json_str "$(hostname)")" "$(json_int "$(uptime_seconds)")" "$(load_json)" \
    "$(memory_json)" "$(disks_json)" "$(containers_json)" "$(backups_json)"
}

if [ "${1:-}" = "--print" ]; then
  status_json
  exit 0
fi

mkdir -p "$STATUS_DIR"
tmp="$STATUS_DIR/.host.json.tmp"
status_json > "$tmp"
mv -f "$tmp" "$STATUS_DIR/host.json"
