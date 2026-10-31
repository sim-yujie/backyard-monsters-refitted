#!/bin/sh
# run.sh <level> <mode> <state> : one Blender render of hccdmg.py, waiting while 2 Blenders already run on the PC
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
"$BL" -b --factory-startup -P hccdmg.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|line [0-9]" | grep -v "^Fra:" | head -30
