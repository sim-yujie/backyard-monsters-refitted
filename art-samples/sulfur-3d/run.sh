#!/bin/sh
# run.sh <tier> <mode> [args] : one Blender run of sulfur.py on one graphics card, holding that card's lock
# (blender-lock-0 = GPU 0, blender-lock-1 = GPU 1; at most one render per card on the PC).
ROOT=/home/yujiesim/Coding/backyard-monsters-refitted
cd "$(dirname "$0")"
n=0; G=
while [ -z "$G" ]; do
  for g in 0 1; do mkdir "$ROOT/blender-lock-$g" 2>/dev/null && { G=$g; break; }; done
  [ -n "$G" ] && break
  n=$((n+1)); [ $n -gt 60 ] && { echo "LOCK busy"; exit 9; }
  sleep 10
done
trap 'rmdir "$ROOT/blender-lock-$G"' EXIT INT TERM
CUDA_VISIBLE_DEVICES=$G ~/.local/bin/blender -b --factory-startup -P sulfur.py -- "$@" 2>&1 | grep -iE "error|Traceback|DONE|PROBE|CHECK|CLEAR|GAP|line [0-9]|Exception|Saved" | grep -v "^Fra:" | head -${PB_LINES:-30}
