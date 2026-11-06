#!/bin/sh
# run.sh <prev|still|check> <damaged|destroyed> : one Blender run of juicedmg.py in the damage frame (waits while 2
# Blenders already run on the PC)
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
PB_FRAME=-64,-14,68,78 "$BL" -b --factory-startup -P juicedmg.py -- 1 "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|PROBE\|FLOAT\|OUTSIDE\|CHECK\|line [0-9]" | grep -v "^Fra:" | head -40
