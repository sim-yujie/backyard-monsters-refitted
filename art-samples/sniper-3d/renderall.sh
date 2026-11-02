#!/bin/sh
# renderall.sh : body + all 32 turret headings for tiers 1-3 (Blender 5.2 in the background)
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
export LOOK3D_NO_LINE=${LOOK3D_NO_LINE-1}   # no outline (owner, 30 Oct 2026)
cd "$(dirname "$0")"
start=$(date +%s)
for t in ${TIERS:-1 2 3}; do
  "$B" -b --factory-startup -P sniper3d.py -- $t body 2>&1 | grep "DONE\|Error"
  "$B" -b --factory-startup -P sniper3d.py -- $t turret 2>&1 | grep "DONE\|Error"
  "$B" -b --factory-startup -P sniper3d.py -- $t aim 2>&1 | grep "DONE\|Error"
done
echo "seconds: $(( $(date +%s) - start ))"
