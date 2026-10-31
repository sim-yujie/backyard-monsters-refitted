#!/bin/sh
# run.sh <look> <mode> [states] : one Blender run of walls.py (waits while 2 or more Blenders run on the PC).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 20; done
"$BL" -b --factory-startup -P walls.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|CONTACT\|STATE\|line [0-9]" | grep -v "^Fra:" | head -${PB_LINES:-60}
