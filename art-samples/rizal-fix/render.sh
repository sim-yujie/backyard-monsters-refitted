#!/bin/bash
# render.sh <layout>... : Rizal Monument block-outs (../decor-real/blockout.py, RIZAL_LAYOUT=old|A|B|Bface) into bo/,
# 1024 px, on a free GPU under the blender lock. Same camera and framing as the 24 Nov pass (bo3/).
cd "$(dirname "$0")"; mkdir -p bo
LK=/home/yujiesim/Coding/backyard-monsters-refitted/blender-lock
LOG=/home/yujiesim/Coding/backyard-monsters-refitted/archive/logs
G=""
until [ -n "$G" ]; do
  if mkdir $LK-0 2>/dev/null; then G=0; elif mkdir $LK-1 2>/dev/null; then G=1; else sleep 60; fi
done
for l in "$@"; do
  [ "${l%-ns}" != "$l" ] && export NOSLAB=1 || unset NOSLAB
  RIZAL_LAYOUT=${l%-ns} CUDA_VISIBLE_DEVICES=$G timeout 600 blender -b --python ../decor-real/blockout.py -- rizal-monument $PWD/bo/$l.png 1024 > $LOG/rizal-fix-blender-$l.log 2>&1
  grep CORNERS $LOG/rizal-fix-blender-$l.log | cut -c9- > bo/$l.json
  grep -E "Error|Traceback" -A3 $LOG/rizal-fix-blender-$l.log | head -8
  python3 -c "
from PIL import Image
i=Image.open('bo/$l.png'); m=Image.new('RGBA',i.size,(255,0,255,255)); m.alpha_composite(i); m.convert('RGB').save('bo/$l-magenta.png')"
  echo "$l done"
done
rmdir $LK-$G
