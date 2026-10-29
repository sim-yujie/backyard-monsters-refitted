#!/bin/sh
# run.sh <level> <mode> [frames] : one Blender render of twig2.py, after any other Blender on the PC has finished
# (only one render may run at a time).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
while tasklist 2>/dev/null | grep -qi "^blender.exe"; do sleep 15; done
"$BL" -b --factory-startup -P twig2.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|line [0-9]" | grep -v "^Fra:" | head -30
