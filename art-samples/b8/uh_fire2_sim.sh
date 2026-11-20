#!/bin/bash
# uh_fire2_sim.sh <name> <out dir> [key=value ...] : one uh_fire2_sim.py run on one graphics card, holding that
# card's Blender lock for the length of the run (helper rules: one render per card, never both locks).
R=/home/yujiesim/Coding/backyard-monsters-refitted
HERE=$(cd "$(dirname "$0")" && pwd)
while true; do
  if mkdir $R/blender-lock-0 2>/dev/null; then L=0; break; fi
  if mkdir $R/blender-lock-1 2>/dev/null; then L=1; break; fi
  sleep 120
done
trap "rmdir $R/blender-lock-$L" EXIT
mkdir -p "$2"
CUDA_VISIBLE_DEVICES=$L ~/.local/bin/blender -b --factory-startup --python $HERE/uh_fire2_sim.py -- "$@" > "$2/$1.log" 2>&1
grep -E "^(BAKE|RENDER|DONE)|Error|Traceback" -A2 "$2/$1.log" | head -20
