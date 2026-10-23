#!/bin/bash
# usage: job.sh <sheet> <A|B> <col> [extra painted cutouts...] : set up, paint (one Codex call) and check one grid.
K=$(cd "$(dirname "$0")" && pwd)
d=$(python "$K/make_batch.py" "$@") || { echo "setup failed: $*"; exit 1; }
bash "$K/run.sh" "$d" >/dev/null
[ -f "$d/frames-new.png" ] && python "$K/check_grid.py" $1 $2 $3 >/dev/null
echo "done $1 $2$3 $([ -f "$d/frames-new.png" ] && echo ok || echo NO-OUTPUT)"
