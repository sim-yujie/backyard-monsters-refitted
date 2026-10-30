#!/bin/sh
# run.sh <level> <mode> : one Blender run of hatch.py (waits while 2 or more Blenders run on the PC).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 20; done
"$BL" -b --factory-startup -P hatch.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|CHECK\|TRACK\|CLEAR\|GAP\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -${PB_LINES:-60}
