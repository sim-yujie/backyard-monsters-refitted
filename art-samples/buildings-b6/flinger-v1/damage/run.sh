#!/bin/sh
# run.sh <look> <prev|still> <damaged|destroyed> : one Blender render of flingdmg.py, waiting while 2 Blenders already run
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
PB_FRAME=-80,-72,104,82 "$BL" -b --factory-startup -P flingdmg.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -30
