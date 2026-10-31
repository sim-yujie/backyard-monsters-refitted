#!/bin/sh
# run.sh <level> <mode> <state> : one Blender run of lockerdmg.py (waits while 2 Blenders already run on the PC)
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
PB_FRAME=-72,-100,170,116 "$BL" -b --factory-startup -P lockerdmg.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|PROBE\|FLOAT\|OUTSIDE\|line [0-9]" | grep -v "^Fra:" | head -${PB_LINES:-40}
