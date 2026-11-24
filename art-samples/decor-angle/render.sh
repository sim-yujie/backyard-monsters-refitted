#!/bin/bash
# render.sh <wonder>... : block-out renders on a free GPU (takes the blender lock, releases it after)
cd "$(dirname "$0")"; mkdir -p bo
LK=/home/yujiesim/Coding/backyard-monsters-refitted/blender-lock
G=""
until [ -n "$G" ]; do
  if mkdir $LK-0 2>/dev/null; then G=0; elif mkdir $LK-1 2>/dev/null; then G=1; else sleep 120; fi
done
for n in "$@"; do
  CUDA_VISIBLE_DEVICES=$G timeout 600 blender -b --python blockout.py -- $n $PWD/bo/$n.png 1024 > /home/yujiesim/Coding/backyard-monsters-refitted/archive/logs/decor-angle-blender-$n.log 2>&1
  grep CORNERS /home/yujiesim/Coding/backyard-monsters-refitted/archive/logs/decor-angle-blender-$n.log | cut -c9- > bo/$n.json
  echo "$n rc $? $(grep CORNERS /home/yujiesim/Coding/backyard-monsters-refitted/archive/logs/decor-angle-blender-$n.log | cut -c1-120)"
  grep -E "Error|Traceback" /home/yujiesim/Coding/backyard-monsters-refitted/archive/logs/decor-angle-blender-$n.log | head -3
done
rmdir $LK-$G
