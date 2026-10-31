#!/bin/sh
# run.sh <look> <prev|still|check> <damaged|destroyed> : one Blender run of catdmg.py, waiting while 2 Blenders already run
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
PB_FRAME=-64,-40,80,84 "$BL" -b --factory-startup -P catdmg.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|PROBE\|FLOAT\|OUTSIDE\|line [0-9]" | grep -v "^Fra:\|HIPEW" | head -30
