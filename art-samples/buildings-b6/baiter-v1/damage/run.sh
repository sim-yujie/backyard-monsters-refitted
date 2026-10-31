#!/bin/sh
# run.sh <mode> <state> : one Blender run of baiterdmg.py (mode prev | still | float), waiting while 2 Blenders run
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
"$BL" -b --factory-startup -P baiterdmg.py -- 1 "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|FLOAT\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -40
