#!/bin/sh
# run.sh <tier> <mode> [args] : one Blender run of coal.py, holding one of the PC's two Blender GPU locks while it
# renders (blender-lock-0 = GPU 0, blender-lock-1 = GPU 1; CUDA only under WSL). PB_SUB=<folder> renders elsewhere.
BL=${BLENDER:-blender}
ROOT=/home/yujiesim/Coding/backyard-monsters-refitted
cd "$(dirname "$0")"
n=0; G=
while [ -z "$G" ]; do
  for g in 0 1; do mkdir "$ROOT/blender-lock-$g" 2>/dev/null && { G=$g; break; }; done
  [ -n "$G" ] && break
  n=$((n+1)); [ $n -gt 40 ] && { echo "LOCK busy"; exit 9; }
  sleep 15
done
trap 'rmdir "$ROOT/blender-lock-$G"' EXIT INT TERM
CUDA_VISIBLE_DEVICES=$G "$BL" -b --factory-startup -P coal.py -- "$@" 2>&1 | grep -iE "error|Traceback|DONE|PROBE|CHECK|CLEAR|GAP|DEVICE|line [0-9]|Exception" | grep -v "^Fra:" | head -${PB_LINES:-30}
