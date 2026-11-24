#!/bin/bash
# render.sh <name>... : block-out renders on a free GPU (takes the blender lock, releases it after)
cd "$(dirname "$0")"; mkdir -p bo
LK=/home/yujiesim/Coding/backyard-monsters-refitted/blender-lock
LOG=/home/yujiesim/Coding/backyard-monsters-refitted/archive/logs
G=""
until [ -n "$G" ]; do
  if mkdir $LK-0 2>/dev/null; then G=0; elif mkdir $LK-1 2>/dev/null; then G=1; else sleep 120; fi
done
for n in "$@"; do
  CUDA_VISIBLE_DEVICES=$G timeout 600 blender -b --python blockout.py -- $n $PWD/bo/$n.png 1024 > $LOG/decor-real-blender-$n.log 2>&1
  grep CORNERS $LOG/decor-real-blender-$n.log | cut -c9- > bo/$n.json
  echo "$n $(grep CORNERS $LOG/decor-real-blender-$n.log | cut -c1-100)"
  grep -E "Error|Traceback" -A3 $LOG/decor-real-blender-$n.log | head -8
  python3 -c "
from PIL import Image
i=Image.open('bo/$n.png'); m=Image.new('RGBA',i.size,(255,0,255,255)); m.alpha_composite(i); m.convert('RGB').save('bo/$n-magenta.png')"
done
rmdir $LK-$G
