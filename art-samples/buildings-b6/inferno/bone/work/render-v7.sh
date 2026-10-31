#!/bin/sh
# v7: L1 still, then both animations, one Blender at a time from this helper (waits while 2 run on the PC).
cd "$(dirname "$0")/.."
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
for job in "1 still" "1 anim" "3 anim"; do
  while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
  set -- $job
  "$BL" -b --factory-startup -P bone3d.py -- $1 $2 > "D:/Coding/BYMR/archive/logs/bone-v7-L$1-$2.log" 2>&1
  echo "L$1 $2 exit $?" >> D:/Coding/BYMR/archive/logs/bone-v7-render.log
done
echo ALLDONE >> D:/Coding/BYMR/archive/logs/bone-v7-render.log
