#!/bin/bash
# run.sh <mode> [extra args] : one Blender run of works.py on one graphics card, under the PC's Blender lock.
# Whole job (about 5 minutes on one card):
#   PB_K=8 ./run.sh still                                   render/L1-base.png, L1-alone.png, L1-parts-00.png
#   PB_K=8 PB_EXTRA=1 PB_FIRST=1 ./run.sh anim              render/L1-parts-01..60.png (60 = frame 0 again, the loop check)
#   PB_K=8 PB_STATE=damaged PB_SUB=damaged ./run.sh base    damaged/render/L1-damaged-base.png, -alone.png
#   then post.py frames, sheets, crops, check, mp4 with a python that has numpy and Pillow, e.g.
#   <blender>/5.2/python/bin/python3.13 -m venv <worktree>/.venv-art && <worktree>/.venv-art/bin/python -m pip install numpy pillow
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
cd "$HERE" && CUDA_VISIBLE_DEVICES=$N "$HOME/.local/bin/blender" -b --factory-startup -P works.py -- 1 "$@" 2>&1 \
  | grep -v -E '^(Fra|Saved|Blender| Time|$)|OptiX|HIPEW'
