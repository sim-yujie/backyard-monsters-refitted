#!/bin/bash
# run.sh <mode> [extra args] : one Blender run of strongbox.py on one graphics card, under the PC's Blender lock.
# Takes blender-lock-0 (GPU 0) or blender-lock-1 (GPU 1), whichever is free (waits if both are held), renders on
# that card only with CUDA, and gives the lock back. Env: PB_K, PB_SAMPLES, PB_SUB, PB_EXTRA, PB_FIRST, PB_ALONE.
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT=/home/yujiesim/Coding/backyard-monsters-refitted
N=""
while [ -z "$N" ]; do
  for i in 0 1; do
    if mkdir "$ROOT/blender-lock-$i" 2>/dev/null; then N=$i; break; fi
  done
  [ -z "$N" ] && sleep 120
done
trap 'rmdir "$ROOT/blender-lock-$N"' EXIT
echo "lock $N"
cd "$HERE" && CUDA_VISIBLE_DEVICES=$N "$HOME/.local/bin/blender" -b --factory-startup -P strongbox.py -- 1 "$@" 2>&1 \
  | grep -v -E '^(Fra|Saved|Blender| Time|$)|OptiX|HIPEW'
