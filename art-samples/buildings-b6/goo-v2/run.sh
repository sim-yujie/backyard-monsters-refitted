#!/bin/sh
# run.sh <level> <mode> : one Blender run of goo2.py, started once fewer than 2 Blenders run on the PC (the shared
# limit).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci "^blender.exe")" -ge 2 ]; do sleep 15; done
"$BL" -b --factory-startup -P goo2.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|CHECK\|CLEAR\|GAP\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -${PB_LINES:-60}
