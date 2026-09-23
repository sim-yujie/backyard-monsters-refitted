#!/usr/bin/env bash
#
# verify-economy-save.sh — exercises the /base/save economy audit end to end
# against a real local server, for one ECONOMY_SAVE_VALIDATION mode at a time.
#
# Design: docs/design/economy-save-validation.md §4.2. Implements its curl
# verification script, steps 1-8, using curl + jq only (no bun/node/psql
# client — the DB steps go through `docker exec ... psql` in the running
# `bymr-database` container).
#
# WHAT THIS TESTS
#   1. Log in as the sandbox account.
#   2. Load its main yard.
#   3. Resend the loaded state unchanged (a zero-delta "identity" save) —
#      must always succeed, and in `reject` mode must come back with the
#      server-derived storage cap rather than the stored one.
#   4. Resend it with a 1,000,000,000 r1 "cheat" delta that no harvester,
#      refund or top-up could explain — must be flagged (`resourceBudget`).
#   5. Resend it with a Cannon Tower's level set straight to 10 with no
#      countdown — must be flagged (`levelJumped`).
#   6. Add one Wooden Block wall: first a zero-net swap (remove one existing
#      wall, add one new one — see the NOTE below on why this substitutes for
#      the design doc's literal step), which must succeed; then one more wall
#      with no removal, which must be flagged (`capReached`).
#   7. Start a legitimate, fully-charged Cannon Tower upgrade countdown, resave
#      it unchanged a moment later (must still succeed — a countdown that
#      merely hasn't ticked down yet is fine), then try to yank it down faster
#      than real time with no voucher (must be flagged, `countdownJumped`),
#      then the same yank with an `SP2` voucher (must succeed).
#   8. Restore the account's `save` row from the step-0 snapshot, always, even
#      on Ctrl-C or an early failure.
#
# Each check prints "PASS: ..." or "FAIL: ...". The script's own exit code is
# 0 only if every check passed.
#
# NOTE on deviations from the design doc's literal step 6 and step 7 numbers:
#   - Step 6 in the design doc adds one wall and expects `error: 0`, then adds
#     a "401st wall" and expects `capReached`. The live sandbox account
#     (userid 2503) already holds exactly 400 level-1 Wooden Blocks — the
#     Town-Hall-10 cap for that type (`quantity: [...,400]` in
#     server/src/game-data/buildingCosts.ts's row 17). So adding a single new
#     wall on top of that already trips `capReached`; there is no "under cap"
#     wall add left to demonstrate the happy path with. This script instead
#     does a same-count *swap* (remove one existing wall, add one new one —
#     net count unchanged) for the happy-path check, then a genuine
#     over-the-cap add for the `capReached` check. If a future fixture change
#     leaves the account with fewer than 400 walls, both checks still hold.
#   - Step 7's "reduce cU by 3600s" example assumes a countdown long enough to
#     absorb a 3600s cut. The Cannon Tower's actual level 1->2 step is only
#     900 seconds (`costs[1]` in the same file), so this script cuts it by
#     300 seconds instead — comfortably past the 10s timer tolerance plus
#     request latency, so it still unambiguously trips `countdownJumped`
#     without going negative — and then excuses the same 300s cut with an
#     `SP2` voucher (which buys 3600s of slack, far more than needed).
#
# PREREQUISITES
#   - `docker compose up -d db redis` (from `server/`), so `bymr-database` is
#     running with the seeded sandbox account.
#   - The server running with the mode under test:
#       cd server && ECONOMY_SAVE_VALIDATION=<mode> DEV_SANDBOX=true bun run dev
#     This script does not — cannot — change a running server's mode; it only
#     asserts against whatever mode the server was started with. Pass the
#     *same* mode as this script's argument so the assertions match.
#   - `curl` and `jq` on PATH.
#
# USAGE
#   server/scripts/verify-economy-save.sh <off|log|reject>
#
# ENVIRONMENT OVERRIDES (all optional)
#   BASE_URL             default http://localhost:3001
#   API_VERSION           default v1
#   ECON_TEST_EMAIL        default yardtester@test.com
#   ECON_TEST_PASSWORD     default Dev12345!
#   ECON_TEST_USERID       default 2503
#   DB_CONTAINER           default bymr-database
#   SERVER_LOG_FILE        if set, grepped for the expected rule name after
#                          each `log`-mode check that should have logged one.
#                          Left unset, the script just prints a reminder to
#                          check the server console by hand — a plain curl+jq
#                          script has no other way to read another process's
#                          stdout.
#
set -uo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

MODE="${1:-}"
if [[ "$MODE" != "off" && "$MODE" != "log" && "$MODE" != "reject" ]]; then
  echo "Usage: $0 <off|log|reject>" >&2
  exit 2
fi

BASE_URL="${BASE_URL:-http://localhost:3001}"
API_VERSION="${API_VERSION:-v1}"
EMAIL="${ECON_TEST_EMAIL:-yardtester@test.com}"
PASSWORD="${ECON_TEST_PASSWORD:-Dev12345!}"
USERID="${ECON_TEST_USERID:-2503}"
DB_CONTAINER="${DB_CONTAINER:-bymr-database}"
SERVER_LOG_FILE="${SERVER_LOG_FILE:-}"

# Read DB creds out of server/.env (falls back to example.env's defaults).
env_val() {
  local key="$1" default="$2" line=""
  if [[ -f "$ENV_FILE" ]]; then
    line=$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d'=' -f2-)
    line="${line%\'}"; line="${line#\'}"
    line="${line%\"}"; line="${line#\"}"
  fi
  [[ -n "$line" ]] && echo "$line" || echo "$default"
}

DB_NAME="$(env_val DB_NAME bym)"
DB_USER="$(env_val DB_USER postgres)"
DB_PASSWORD="$(env_val DB_PASSWORD dev12345)"

for cmd in curl jq docker; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "FAIL: '$cmd' is required on PATH" >&2; exit 2; }
done

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
note() { echo "NOTE: $1"; }

die() {
  echo "ABORT: $1" >&2
  exit 1
}

check_log_for_rule() {
  local rule="$1" context="$2"
  if [[ -n "$SERVER_LOG_FILE" ]]; then
    if [[ -f "$SERVER_LOG_FILE" ]] && grep -q "$rule" "$SERVER_LOG_FILE"; then
      pass "$context: server log mentions '$rule'"
    else
      fail "$context: no '$rule' line found in \$SERVER_LOG_FILE ($SERVER_LOG_FILE)"
    fi
  else
    note "$context: \$SERVER_LOG_FILE not set — check the server console by hand for a warning naming '$rule'"
  fi
}

# ---------------------------------------------------------------------------
# psql helpers (read-only query / single statement, via docker exec)
# ---------------------------------------------------------------------------

psql_query() {
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -t -A -v ON_ERROR_STOP=1 -c "$1"
}

# The statement arrives on stdin, not as -c. The restore in step 8 rewrites a
# 575-building `buildingdata`, which makes for roughly a megabyte of SQL — well
# past the command-line length every OS enforces (Windows gives up at 32 KB with
# "Argument list too long", and Linux's ARG_MAX is not far enough behind to rely
# on). Piping it in has no such limit.
psql_exec() {
  printf '%s\n' "$1" | docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 >/dev/null
}

# ---------------------------------------------------------------------------
# Step 0: snapshot the account's save row and arm the restore trap
# ---------------------------------------------------------------------------

echo "=== Step 0: snapshot bym.save for userid=$USERID (mode=$MODE) ==="

SNAPSHOT_SQL="$(psql_query "
  SELECT format(
    'UPDATE bym.save SET buildingdata = %L::jsonb, buildinghealthdata = %L::jsonb, resources = %L::jsonb, points = %L, basevalue = %L, savetime = %L WHERE basesaveid = %L;',
    buildingdata, buildinghealthdata, resources, points, basevalue, savetime, basesaveid
  ) FROM bym.save WHERE userid = $USERID AND type = 'main';
")"

[[ -n "$SNAPSHOT_SQL" ]] || die "no bym.save row found for userid=$USERID type=main — is the sandbox account seeded?"

RESTORED=0
restore_snapshot() {
  if [[ "$RESTORED" -eq 1 ]]; then return; fi
  RESTORED=1
  echo "=== Step 8: restoring bym.save for userid=$USERID from the step-0 snapshot ==="
  if psql_exec "$SNAPSHOT_SQL"; then
    echo "Restored."
  else
    echo "RESTORE FAILED — bym.save for userid=$USERID may be left mutated. Re-run this script's step-0 query by hand." >&2
  fi
}
trap restore_snapshot EXIT INT TERM

# ---------------------------------------------------------------------------
# Step 1: log in
# ---------------------------------------------------------------------------

echo "=== Step 1: log in as $EMAIL ==="

LOGIN_RESPONSE="$(curl -sS -X POST "$BASE_URL/api/$API_VERSION/player/getinfo" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASSWORD" \
  --data-urlencode "sessionType=game")"

TOKEN="$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')"
LOGIN_USERID="$(echo "$LOGIN_RESPONSE" | jq -r '.userId // empty')"

if [[ -z "$TOKEN" ]]; then
  fail "login: no token in response ($LOGIN_RESPONSE)"
  exit 1
fi
if [[ "$LOGIN_USERID" != "$USERID" ]]; then
  fail "login: logged in as userid=$LOGIN_USERID, expected $USERID"
else
  pass "login: got a token for userid=$USERID"
fi

http_post() {
  local url="$1"; shift
  curl -sS -X POST "$BASE_URL$url" -H "Authorization: Bearer $TOKEN" "$@"
}

# ---------------------------------------------------------------------------
# Step 2: load the main yard
# ---------------------------------------------------------------------------

echo "=== Step 2: load the main yard ==="

load_base() {
  http_post "/base/load" \
    --data-urlencode "type=build" \
    --data-urlencode "userid=$USERID" \
    --data-urlencode "baseid=0"
}

LOAD="$(load_base)"
BASESAVEID="$(echo "$LOAD" | jq -r '.basesaveid // empty')"
BASEID="$(echo "$LOAD" | jq -r '.baseid // empty')"

if [[ -z "$BASESAVEID" || -z "$BASEID" ]]; then
  fail "load: missing basesaveid/baseid in response ($LOAD)"
  exit 1
fi
pass "load: basesaveid=$BASESAVEID baseid=$BASEID"

ORIG_R1="$(echo "$LOAD" | jq -r '.resources.r1')"

# ---------------------------------------------------------------------------
# save_base: build a form-encoded /base/save request out of jq-built pieces
# ---------------------------------------------------------------------------

save_base() {
  # args: buildingdata_json buildinghealthdata_json resources_json points basevalue [purchase_json]
  local buildingdata="$1" buildinghealthdata="$2" resources="$3" points="$4" basevalue="$5" purchase="${6:-}"
  local args=(
    --data-urlencode "basesaveid=$BASESAVEID"
    --data-urlencode "baseid=$BASEID"
    --data-urlencode "buildingdata=$buildingdata"
    --data-urlencode "buildinghealthdata=$buildinghealthdata"
    --data-urlencode "resources=$resources"
    --data-urlencode "points=$points"
    --data-urlencode "basevalue=$basevalue"
  )
  [[ -n "$purchase" ]] && args+=(--data-urlencode "purchase=$purchase")
  http_post "/base/save" "${args[@]}"
}

# Builds a zero-delta resources JSON string from a /base/load response's
# `.resources`, so a save that otherwise changes nothing reports no delta.
identity_resources() {
  echo "$1" | jq -c '.resources | {r1:0,r2:0,r3:0,r4:0,r1max,r2max,r3max,r4max}'
}

# Asserts a save response is a plain, unrejected success.
assert_success() {
  local response="$1" label="$2"
  local err
  err="$(echo "$response" | jq -r '.error')"
  if [[ "$err" == "0" ]]; then
    pass "$label: error: 0"
  else
    fail "$label: expected error: 0, got $(echo "$response" | jq -c '{error, errorDetails}')"
  fi
}

# Asserts a save response matches this mode's expectation for a violation:
#   off    -> always succeeds (audit does not run)
#   log    -> always succeeds (audit never blocks); checks the log for $rule
#   reject -> HTTP 200, error set, errorDetails.status 409, violations[].rule
#             contains $rule
assert_rule_outcome() {
  local response="$1" rule="$2" label="$3"
  case "$MODE" in
    off)
      assert_success "$response" "$label (off: audit disabled)"
      ;;
    log)
      assert_success "$response" "$label (log: never blocks)"
      check_log_for_rule "$rule" "$label"
      ;;
    reject)
      local err status has_rule
      err="$(echo "$response" | jq -r '.error')"
      status="$(echo "$response" | jq -r '.errorDetails.status // empty')"
      has_rule="$(echo "$response" | jq -r --arg rule "$rule" \
        '[.errorDetails.data.violations[]?.rule] | any(. == $rule)')"
      if [[ "$err" != "0" && "$err" != "null" && -n "$err" && "$status" == "409" && "$has_rule" == "true" ]]; then
        pass "$label: rejected with status 409 and rule '$rule'"
      else
        fail "$label: expected a 409 rejection naming '$rule', got $(echo "$response" | jq -c '{error, errorDetails}')"
      fi
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Step 3: identity save
# ---------------------------------------------------------------------------

echo "=== Step 3: identity save (zero delta, everything else unchanged) ==="

BUILDINGDATA="$(echo "$LOAD" | jq -c '.buildingdata')"
BUILDINGHEALTHDATA="$(echo "$LOAD" | jq -c '.buildinghealthdata // {}')"
POINTS="$(echo "$LOAD" | jq -r '.points')"
BASEVALUE="$(echo "$LOAD" | jq -r '.basevalue')"

RESOURCES3="$(identity_resources "$LOAD")"
SAVE3="$(save_base "$BUILDINGDATA" "$BUILDINGHEALTHDATA" "$RESOURCES3" "$POINTS" "$BASEVALUE")"
assert_success "$SAVE3" "step3 identity save"

if [[ "$MODE" == "reject" ]]; then
  R1MAX3="$(echo "$SAVE3" | jq -r '.resources.r1max // empty')"
  if [[ "$R1MAX3" == "23050000" ]]; then
    pass "step3 derived cap: resources.r1max == 23050000 (server-derived, not the client's 11163050000)"
  else
    fail "step3 derived cap: expected resources.r1max == 23050000, got $R1MAX3"
  fi
else
  note "step3 derived cap: only asserted in reject mode (off/log store rNmax as sent)"
fi

# ---------------------------------------------------------------------------
# Step 4: cheat delta
# ---------------------------------------------------------------------------

echo "=== Step 4: cheat delta (+1,000,000,000 r1 with nothing to explain it) ==="

LOAD4="$(load_base)"
BUILDINGDATA4="$(echo "$LOAD4" | jq -c '.buildingdata')"
BUILDINGHEALTHDATA4="$(echo "$LOAD4" | jq -c '.buildinghealthdata // {}')"
POINTS4="$(echo "$LOAD4" | jq -r '.points')"
BASEVALUE4="$(echo "$LOAD4" | jq -r '.basevalue')"
RESOURCES4="$(echo "$LOAD4" | jq -c '.resources | {r1:1000000000,r2:0,r3:0,r4:0,r1max,r2max,r3max,r4max}')"

SAVE4="$(save_base "$BUILDINGDATA4" "$BUILDINGHEALTHDATA4" "$RESOURCES4" "$POINTS4" "$BASEVALUE4")"
assert_rule_outcome "$SAVE4" "resourceBudget" "step4 cheat delta"

LOAD4B="$(load_base)"
R1_AFTER="$(echo "$LOAD4B" | jq -r '.resources.r1')"
BASE_R1="$(echo "$LOAD4" | jq -r '.resources.r1')"

if [[ "$MODE" == "reject" ]]; then
  if [[ "$R1_AFTER" == "$BASE_R1" ]]; then
    pass "step4 reload: resources.r1 unchanged ($R1_AFTER) — the cheat save was refused"
  else
    fail "step4 reload: expected resources.r1 unchanged at $BASE_R1, got $R1_AFTER"
  fi
else
  EXPECTED_R1=$(( BASE_R1 + 1000000000 ))
  if [[ "$R1_AFTER" == "$EXPECTED_R1" ]]; then
    pass "step4 reload ($MODE): resources.r1 increased by the full delta to $R1_AFTER, as $MODE mode never blocks a save"
  else
    fail "step4 reload ($MODE): expected resources.r1 == $EXPECTED_R1, got $R1_AFTER"
  fi
fi

# ---------------------------------------------------------------------------
# Step 5: level jump
# ---------------------------------------------------------------------------

echo "=== Step 5: level jump (a Cannon Tower straight to level 10, no countdown) ==="

LOAD5="$(load_base)"
CANNON_IDS_JSON="$(echo "$LOAD5" | jq -c '[.buildingdata | to_entries[] | select(.value.t == 20) | (.value.id)] | sort')"
CANNON_COUNT="$(echo "$CANNON_IDS_JSON" | jq 'length')"

if [[ "$CANNON_COUNT" -lt 2 ]]; then
  die "expected at least 2 Cannon Towers (t: 20) in the fixture for steps 5 and 7 to use separate ones, found $CANNON_COUNT"
fi

STEP5_TOWER_ID="$(echo "$CANNON_IDS_JSON" | jq -r '.[0]')"
STEP7_TOWER_ID="$(echo "$CANNON_IDS_JSON" | jq -r '.[1]')"
note "step5/7 use two different Cannon Towers (ids $STEP5_TOWER_ID and $STEP7_TOWER_ID) so that step 5's illegal jump — which off/log modes actually persist, since neither one blocks a save — can't leave step 7's tower already maxed out"

BUILDINGDATA5="$(echo "$LOAD5" | jq -c --arg id "$STEP5_TOWER_ID" \
  '.buildingdata | .[$id].l = 10 | del(.[$id].cU)')"
BUILDINGHEALTHDATA5="$(echo "$LOAD5" | jq -c '.buildinghealthdata // {}')"
POINTS5="$(echo "$LOAD5" | jq -r '.points')"
BASEVALUE5="$(echo "$LOAD5" | jq -r '.basevalue')"
RESOURCES5="$(identity_resources "$LOAD5")"

SAVE5="$(save_base "$BUILDINGDATA5" "$BUILDINGHEALTHDATA5" "$RESOURCES5" "$POINTS5" "$BASEVALUE5")"
assert_rule_outcome "$SAVE5" "levelJumped" "step5 level jump"

# ---------------------------------------------------------------------------
# Step 6: new wall / capacity cap
# ---------------------------------------------------------------------------

echo "=== Step 6a: at-cap wall swap (remove one Wooden Block, add one — net count unchanged) ==="

LOAD6="$(load_base)"
WALL_IDS_JSON="$(echo "$LOAD6" | jq -c '[.buildingdata | to_entries[] | select(.value.t == 17) | (.value.id)] | sort')"
WALL_COUNT="$(echo "$WALL_IDS_JSON" | jq 'length')"
MAX_ID="$(echo "$LOAD6" | jq '[.buildingdata | to_entries[] | (.value.id)] | max')"

note "wall count before step 6 is $WALL_COUNT (the fixture's Town-Hall-10 cap for type 17 is 400 — see the NOTE at the top of this script)"

OLD_WALL_ID="$(echo "$WALL_IDS_JSON" | jq -r '.[0]')"
NEW_WALL_ID_A=$(( MAX_ID + 1 ))

BUILDINGDATA6A="$(echo "$LOAD6" | jq -c \
  --arg oldid "$OLD_WALL_ID" --argjson newid "$NEW_WALL_ID_A" \
  '.buildingdata | del(.[$oldid]) | .[($newid | tostring)] = {id: $newid, t: 17, X: 1000, Y: 1000}')"
BUILDINGHEALTHDATA6="$(echo "$LOAD6" | jq -c '.buildinghealthdata // {}')"
POINTS6="$(echo "$LOAD6" | jq -r '.points')"
BASEVALUE6="$(echo "$LOAD6" | jq -r '.basevalue')"
RESOURCES6A="$(identity_resources "$LOAD6")"

SAVE6A="$(save_base "$BUILDINGDATA6A" "$BUILDINGHEALTHDATA6" "$RESOURCES6A" "$POINTS6" "$BASEVALUE6")"
assert_success "$SAVE6A" "step6a wall swap (net count unchanged, all modes)"

echo "=== Step 6b: one more wall, no removal — over the cap ==="

LOAD6B="$(load_base)"
MAX_ID_B="$(echo "$LOAD6B" | jq '[.buildingdata | to_entries[] | (.value.id)] | max')"
NEW_WALL_ID_B=$(( MAX_ID_B + 1 ))
WALL_COUNT_AFTER="$(echo "$LOAD6B" | jq '[.buildingdata | to_entries[] | select(.value.t == 17)] | length')"
NEW_WALL_TOTAL=$(( WALL_COUNT_AFTER + 1 ))

BUILDINGDATA6B="$(echo "$LOAD6B" | jq -c --argjson newid "$NEW_WALL_ID_B" \
  '.buildingdata | .[($newid | tostring)] = {id: $newid, t: 17, X: 1040, Y: 1000}')"
BUILDINGHEALTHDATA6B="$(echo "$LOAD6B" | jq -c '.buildinghealthdata // {}')"
POINTS6B="$(echo "$LOAD6B" | jq -r '.points')"
BASEVALUE6B="$(echo "$LOAD6B" | jq -r '.basevalue')"
RESOURCES6B="$(identity_resources "$LOAD6B")"

SAVE6B="$(save_base "$BUILDINGDATA6B" "$BUILDINGHEALTHDATA6B" "$RESOURCES6B" "$POINTS6B" "$BASEVALUE6B")"
note "wall count would become $NEW_WALL_TOTAL after this save (cap is 400)"
assert_rule_outcome "$SAVE6B" "capReached" "step6b over-cap wall"

# ---------------------------------------------------------------------------
# Step 7: honest upgrade
# ---------------------------------------------------------------------------

echo "=== Step 7: honest Cannon Tower upgrade ==="

# costs[from] for Cannon Tower (type 20), from server/src/game-data/buildingCosts.ts's
# row 20 (Map Room 2 ladder). Index = current level (costs[0] is the initial build,
# so costs[1] is the level 1->2 step the fixture's fresh towers need). r4 is always 0
# for this building, so it is omitted below.
CT_R1=(2000 10000 50000 250000 1250000 6250000 9375000 14000000 21000000 31600000)
CT_R2=(1500 7500 37500 187500 937500 4687500 7000000 10500000 15800000 23700000)
CT_R3=(500 2500 12500 62500 312500 1562500 1562500 1562500 1562500 1562500)
CT_TIME=(30 900 2700 8100 24300 72900 172800 259200 345600 475200)

LOAD7="$(load_base)"
FROM_LEVEL="$(echo "$LOAD7" | jq -r --arg id "$STEP7_TOWER_ID" '.buildingdata[$id].l // 1')"

if [[ "$FROM_LEVEL" -lt 0 || "$FROM_LEVEL" -gt 9 ]]; then
  fail "step7: tower $STEP7_TOWER_ID is at level $FROM_LEVEL, outside this script's hardcoded 0-9 ladder range — skipping step 7"
else
  STEP_TIME="${CT_TIME[$FROM_LEVEL]}"
  STEP_R1="${CT_R1[$FROM_LEVEL]}"
  STEP_R2="${CT_R2[$FROM_LEVEL]}"
  STEP_R3="${CT_R3[$FROM_LEVEL]}"
  note "step7: tower $STEP7_TOWER_ID is at level $FROM_LEVEL, upgrade step costs r1=$STEP_R1 r2=$STEP_R2 r3=$STEP_R3 time=${STEP_TIME}s"

  BUILDINGHEALTHDATA7="$(echo "$LOAD7" | jq -c '.buildinghealthdata // {}')"
  POINTS7="$(echo "$LOAD7" | jq -r '.points')"
  BASEVALUE7="$(echo "$LOAD7" | jq -r '.basevalue')"

  echo "--- Step 7a: start the upgrade, fully charged ---"
  BUILDINGDATA7A="$(echo "$LOAD7" | jq -c --arg id "$STEP7_TOWER_ID" --argjson cu "$STEP_TIME" \
    '.buildingdata | .[$id].cU = $cu')"
  RESOURCES7A="$(echo "$LOAD7" | jq -c --argjson r1 "$STEP_R1" --argjson r2 "$STEP_R2" --argjson r3 "$STEP_R3" \
    '.resources | {"r1": (-$r1), "r2": (-$r2), "r3": (-$r3), r4: 0, r1max, r2max, r3max, r4max}')"
  SAVE7A="$(save_base "$BUILDINGDATA7A" "$BUILDINGHEALTHDATA7" "$RESOURCES7A" "$POINTS7" "$BASEVALUE7")"
  assert_success "$SAVE7A" "step7a start upgrade (charged costs[$FROM_LEVEL], all modes)"

  echo "--- Step 7b: resave a moment later with the same cU (a countdown that merely hasn't ticked yet) ---"
  sleep 1
  LOAD7B="$(load_base)"
  CU_AFTER_7A="$(echo "$LOAD7B" | jq -r --arg id "$STEP7_TOWER_ID" '.buildingdata[$id].cU // empty')"
  if [[ -z "$CU_AFTER_7A" ]]; then
    fail "step7b: expected a cU on tower $STEP7_TOWER_ID after step 7a, found none — skipping the rest of step 7"
  else
    BUILDINGDATA7B="$(echo "$LOAD7B" | jq -c '.buildingdata')"
    BUILDINGHEALTHDATA7B="$(echo "$LOAD7B" | jq -c '.buildinghealthdata // {}')"
    POINTS7B="$(echo "$LOAD7B" | jq -r '.points')"
    BASEVALUE7B="$(echo "$LOAD7B" | jq -r '.basevalue')"
    RESOURCES7B="$(identity_resources "$LOAD7B")"
    SAVE7B="$(save_base "$BUILDINGDATA7B" "$BUILDINGHEALTHDATA7B" "$RESOURCES7B" "$POINTS7B" "$BASEVALUE7B")"
    assert_success "$SAVE7B" "step7b resave unchanged cU=$CU_AFTER_7A (all modes)"

    echo "--- Step 7c: yank the same cU down by 300s with no voucher — faster than real time allows ---"
    REDUCED_CU=$(( CU_AFTER_7A - 300 ))
    if [[ "$REDUCED_CU" -lt 0 ]]; then REDUCED_CU=0; fi
    LOAD7C="$(load_base)"
    BUILDINGDATA7C="$(echo "$LOAD7C" | jq -c --arg id "$STEP7_TOWER_ID" --argjson cu "$REDUCED_CU" \
      '.buildingdata | .[$id].cU = $cu')"
    BUILDINGHEALTHDATA7C="$(echo "$LOAD7C" | jq -c '.buildinghealthdata // {}')"
    POINTS7C="$(echo "$LOAD7C" | jq -r '.points')"
    BASEVALUE7C="$(echo "$LOAD7C" | jq -r '.basevalue')"
    RESOURCES7C="$(identity_resources "$LOAD7C")"
    SAVE7C="$(save_base "$BUILDINGDATA7C" "$BUILDINGHEALTHDATA7C" "$RESOURCES7C" "$POINTS7C" "$BASEVALUE7C")"
    assert_rule_outcome "$SAVE7C" "countdownJumped" "step7c countdown cut with no voucher"

    echo "--- Step 7d: the same cut, excused by an SP2 voucher (buys 3600s of slack) ---"
    LOAD7D="$(load_base)"
    BUILDINGDATA7D="$(echo "$LOAD7D" | jq -c --arg id "$STEP7_TOWER_ID" --argjson cu "$REDUCED_CU" \
      '.buildingdata | .[$id].cU = $cu')"
    BUILDINGHEALTHDATA7D="$(echo "$LOAD7D" | jq -c '.buildinghealthdata // {}')"
    POINTS7D="$(echo "$LOAD7D" | jq -r '.points')"
    BASEVALUE7D="$(echo "$LOAD7D" | jq -r '.basevalue')"
    RESOURCES7D="$(identity_resources "$LOAD7D")"
    SAVE7D="$(save_base "$BUILDINGDATA7D" "$BUILDINGHEALTHDATA7D" "$RESOURCES7D" "$POINTS7D" "$BASEVALUE7D" '["SP2",1]')"
    assert_success "$SAVE7D" "step7d same cut with SP2 voucher (all modes)"
  fi
fi

# ---------------------------------------------------------------------------
# Summary (step 8's restore runs via the EXIT trap)
# ---------------------------------------------------------------------------

echo "=== Summary (mode=$MODE) ==="
echo "$PASS_COUNT passed, $FAIL_COUNT failed"

[[ "$FAIL_COUNT" -eq 0 ]]
