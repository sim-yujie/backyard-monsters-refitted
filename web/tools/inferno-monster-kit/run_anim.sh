#!/bin/bash
# run_anim.sh <IC id> <work dir> <heading> ... : anim_ref.py + one Codex call per heading, 4 at a time.
# Stops (exit 3) as soon as a call reports the usage limit.
K=$(cd "$(dirname "$0")" && pwd); PY=${PY:-$HOME/.cache/bymr-art-venv/bin/python}
id=$1; work=$2; shift 2
cd "$K" && "$PY" anim_ref.py "$id" "$work" "$@" > /dev/null || exit 1
set -- "$@"
while [ $# -gt 0 ]; do
  pids=()
  for h in "$1" "$2" "$3" "$4"; do
    [ -z "$h" ] && continue
    bash "$K/codex_call.sh" "$work/anim/h$h" sheet.png "anim-h$h" & pids+=($!)
  done
  stop=0; for p in "${pids[@]}"; do wait $p; [ $? -eq 3 ] && stop=1; done
  [ $stop -eq 1 ] && { echo "usage limit: stopped"; exit 3; }
  shift 4 2>/dev/null || set --
done
