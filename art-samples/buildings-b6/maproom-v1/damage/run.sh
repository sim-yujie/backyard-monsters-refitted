#!/bin/sh
# run.sh <mode> <state> : one Blender render of mapdmg.py (the damage frame), waiting while 3 Blenders already run
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 3 ]; do sleep 15; done
PB_FRAME=-78,-72,92,90 "$BL" -b --factory-startup -P mapdmg.py -- 1 "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -30
