#!/usr/bin/env bash
# The outside check for "game server down" and "game page down"
# (docs/alerts.md). A server that is down cannot say so itself, so this runs
# somewhere else: GitHub Actions, every 5 minutes (.github/workflows/uptime-check.yml).
#
# Each address gets three tries, 20 seconds apart; only three failures in a
# row count as down, so one slow answer is not an alert. Like the server's own
# alerts it says a problem once, again every 12 hours while it lasts, and
# once more when it is fixed. What is down is kept in STATE_DIR between runs
# (the workflow carries it over in the Actions cache).
#
# Settings, from the environment:
#   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID - where the messages go (repository secrets)
#   GAME_SERVER_URL - the game server's heartbeat (default https://api.bymrevamped.com/connection)
#   GAME_PAGE_URL   - the game page (default https://play.bymrevamped.com/)
#   DASHBOARD_URL   - the owner's dashboard page (default https://play.bymrevamped.com/admin)
#   STATE_DIR       - where what is down is kept (default .uptime-state)
#   TRIES, TRY_GAP_SECONDS - how many tries, how far apart (default 3 and 20)
#
# `uptime-check.sh test` sends one test message and checks nothing.
set -euo pipefail

GAME_SERVER_URL="${GAME_SERVER_URL:-https://api.bymrevamped.com/connection}"
GAME_PAGE_URL="${GAME_PAGE_URL:-https://play.bymrevamped.com/}"
DASHBOARD_URL="${DASHBOARD_URL:-https://play.bymrevamped.com/admin}"
STATE_DIR="${STATE_DIR:-.uptime-state}"
TRIES="${TRIES:-3}"
TRY_GAP_SECONDS="${TRY_GAP_SECONDS:-20}"
REMINDER_SECONDS=$((12 * 60 * 60))
TELEGRAM_API="${TELEGRAM_API:-https://api.telegram.org}"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (repository secrets; docs/alerts.md)" >&2
  exit 1
fi

# Sends one plain-text message. The token is never printed; curl's own errors
# are hidden for the same reason. A message Telegram did not take fails the
# run (GitHub then emails the repository owner), and is tried again next run.
send_failed=0
send() {
  local body
  body="$(jq -n --arg chat "$TELEGRAM_CHAT_ID" --arg text "$1" \
    '{chat_id: $chat, text: $text, disable_web_page_preview: true}')"
  if curl -fsS --max-time 20 -o /dev/null -H 'Content-Type: application/json' -d "$body" \
    "${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}/sendMessage" 2>/dev/null; then
    echo "sent: ${1%%$'\n'*}"
  else
    echo "Telegram did not take the message: ${1%%$'\n'*}" >&2
    send_failed=1
    return 1
  fi
}

# "3 h 5 min", "40 min", "2 days 4 h".
duration() {
  local minutes=$(($1 / 60)) days hours mins
  days=$((minutes / 1440)) hours=$(((minutes % 1440) / 60)) mins=$((minutes % 60))
  if [ "$days" -gt 0 ]; then
    printf '%s day%s%s' "$days" "$([ "$days" -eq 1 ] || echo s)" "$([ "$hours" -gt 0 ] && echo " $hours h")"
  elif [ "$hours" -gt 0 ]; then
    printf '%s h%s' "$hours" "$([ "$mins" -gt 0 ] && echo " $mins min")"
  else
    printf '%s min' "$mins"
  fi
}

# Tries an address; prints what the last try got ("HTTP 502", "no answer").
# Succeeds on any 2xx.
probe() {
  local url="$1" try code last="no answer"
  for ((try = 1; try <= TRIES; try++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -A 'bymr-uptime-check' "$url" || true)"
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then return 0; fi
    [ "$code" = "000" ] || [ -z "$code" ] || last="HTTP $code"
    [ "$try" -lt "$TRIES" ] && sleep "$TRY_GAP_SECONDS"
  done
  printf '%s' "$last"
  return 1
}

# One address: compares with what was down last time and says what changed.
check() {
  local key="$1" what="$2" url="$3" state="$STATE_DIR/$1" now result since last_sent
  now="$(date -u +%s)"
  if result="$(probe "$url")"; then
    if [ -f "$state" ]; then
      read -r since _last_sent < "$state"
      send "BYMR fixed: $what is back
It was down for about $(duration $((now - since))).
${DASHBOARD_URL}#health" && rm -f "$state"
    else
      echo "up: $what"
    fi
    return 0
  fi

  if [ ! -f "$state" ]; then
    send "BYMR problem: $what is down
$url gave $result, $TRIES times in a row (checked from GitHub Actions).
${DASHBOARD_URL}#health" && echo "$now $now" > "$state"
  else
    read -r since last_sent < "$state"
    if [ $((now - last_sent)) -ge "$REMINDER_SECONDS" ]; then
      send "BYMR still a problem (for $(duration $((now - since)))): $what is down
$url gave $result.
${DASHBOARD_URL}#health" && echo "$since $now" > "$state"
    else
      echo "still down: $what (already said)"
    fi
  fi
}

if [ "${1:-}" = "test" ]; then
  send "BYMR test alert from the uptime check (GitHub Actions): Telegram alerts are working.
${DASHBOARD_URL}#health"
  exit
fi

mkdir -p "$STATE_DIR"
# Something to carry over even when all is up (the cache keeps no empty folder).
date -u +%FT%TZ > "$STATE_DIR/last-run"
check game-server "The game server" "$GAME_SERVER_URL" || true
check game-page "The game page" "$GAME_PAGE_URL" || true
exit "$send_failed"
