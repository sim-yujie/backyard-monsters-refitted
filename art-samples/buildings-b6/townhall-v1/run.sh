#!/bin/sh
# run.sh <level> <mode> : one Blender run of th.py (waits while 3 or more Blenders run on the PC).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 3 ]; do sleep 20; done
"$BL" -b --factory-startup -P th.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|CHECK\|CLEAR\|GAP\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -${TH_LINES:-60}
