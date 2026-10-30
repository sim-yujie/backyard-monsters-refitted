#!/bin/sh
# renderall.sh : body + all 32 turret headings for tiers 1-3 (Blender 5.2 in the background)
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
start=$(date +%s)
for t in ${TIERS:-1 2 3}; do
  "$B" -b --factory-startup -P sniper3d.py -- $t body 2>&1 | grep "DONE\|Error"
  "$B" -b --factory-startup -P sniper3d.py -- $t turret 2>&1 | grep "DONE\|Error"
done
echo "seconds: $(( $(date +%s) - start ))"
