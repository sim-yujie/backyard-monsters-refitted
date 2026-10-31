#!/bin/sh
# run.sh <level> <mode> <state> : one Blender render of twigdmg.py, waiting while 3 Blenders already run on the PC
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 3 ]; do sleep 15; done
"$BL" -b --factory-startup -P twigdmg.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|line [0-9]" | grep -v "^Fra:" | head -30
