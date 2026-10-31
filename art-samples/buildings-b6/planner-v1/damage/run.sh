#!/bin/sh
# run.sh <mode> <state> : one Blender render of plandmg.py (prev|still, damaged|destroyed), waiting while 2 Blenders run
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
[ "$1" = dry ] || while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
"$BL" -b --factory-startup -P plandmg.py -- 1 "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -30
