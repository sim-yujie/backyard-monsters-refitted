#!/bin/bash
# usage: job.sh <sheet> <A|B|T> <col> [extra painted cutouts...] : set up, paint (one Codex call) and check one grid (T = the turnaround).
# Stops (skips) once any run hit the Codex usage limit: the STOP file next to this script.
K=$(cd "$(dirname "$0")" && pwd)
[ -f "$K/STOP" ] && { echo "skipped $1 $2$3 (usage limit)"; exit 0; }
if [ "$2" = T ]; then
  d=$(python "$K/turnaround.py" $1) || exit 1
else
  d=$(python "$K/make_batch.py" "$@") || { echo "setup failed: $*"; exit 1; }
fi
bash "$K/run.sh" "$d" >/dev/null
grep -a -q "hit your usage limit" "$d/codex.log" && grep -a -m1 "hit your usage limit" "$d/codex.log" > "$K/STOP"
if [ -f "$d/frames-new.png" ]; then
  if [ "$2" = T ]; then python "$K/split_turn.py" $1 >/dev/null; else python "$K/check_grid.py" $1 $2 $3 >/dev/null; fi
fi
echo "done $1 $2$3 $([ -f "$d/frames-new.png" ] && echo ok || echo NO-OUTPUT)"
