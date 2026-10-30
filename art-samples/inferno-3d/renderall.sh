#!/bin/sh
# renderall.sh : body, all 32 turret headings, aim data and the clash check for the Inferno Blast Tower (1), Sharpshooter (2) and Magma Tower (3)
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
start=$(date +%s)
for t in ${TIERS:-1 2 3}; do
  for m in body turret aim clash; do
    "$B" -b --factory-startup -P inferno3d.py -- $t $m 2>&1 | grep "DONE\|CLASH\|Error"
  done
done
echo "seconds: $(( $(date +%s) - start ))"
