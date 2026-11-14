#!/bin/sh
# run.sh <tier> <mode> [args] : one Blender run of magma.py on one graphics card, holding that card's lock
# (blender-lock-0 = GPU 0, else blender-lock-1 = GPU 1) while it renders. Cycles on CUDA (no OptiX under WSL).
BL="$HOME/.local/bin/blender"
ROOT=/home/yujiesim/Coding/backyard-monsters-refitted
cd "$(dirname "$0")"
n=0; G=
while [ -z "$G" ]; do
  for g in 0 1; do mkdir "$ROOT/blender-lock-$g" 2>/dev/null && { G=$g; break; }; done
  [ -n "$G" ] && break
  n=$((n+1)); [ $n -gt 20 ] && { echo "LOCK busy"; exit 9; }
  sleep 30
done
trap 'rmdir "$ROOT/blender-lock-$G"' EXIT INT TERM
echo "GPU $G"
CUDA_VISIBLE_DEVICES=$G "$BL" -b --factory-startup -P magma.py -- "$@" 2>&1 | grep -iE "error|Traceback|DONE|PROBE|CHECK|CLEAR|GAP|line [0-9]|Exception|device" | grep -v "^Fra:" | head -${PB_LINES:-30}
