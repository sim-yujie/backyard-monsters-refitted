#!/bin/sh
# run.sh <level> <mode> : one Blender run of putty2.py, after any other Blender on the PC has finished (only one
# render may run at a time).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while tasklist 2>/dev/null | grep -qi "^blender.exe"; do sleep 15; done
"$BL" -b --factory-startup -P putty2.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|CHECK\|CLEAR\|GAP\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -${PB_LINES:-60}
