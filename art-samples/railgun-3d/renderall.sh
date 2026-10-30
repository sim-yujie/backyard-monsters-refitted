#!/bin/sh
# renderall.sh : body, all 32 turret headings, aim data and the clash check for tiers 1-3 (Blender 5.2 in the background)
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
start=$(date +%s)
for t in ${TIERS:-1 2 3}; do
  for m in body turret aim clash; do
    "$B" -b --factory-startup -P railgun3d.py -- $t $m 2>&1 | grep "DONE\|CLASH\|Error"
  done
done
echo "seconds: $(( $(date +%s) - start ))"
