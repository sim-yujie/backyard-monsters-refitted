#!/bin/sh
cd "$(dirname "$0")/.."
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
for lv in 1 3; do for m in still anim; do
  while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
  "$BL" -b --factory-startup -P bone3d.py -- $lv $m > "D:/Coding/BYMR/archive/logs/bone3d-L$lv-$m.log" 2>&1
  echo "L$lv $m exit $?"
done; done
echo ALLDONE
