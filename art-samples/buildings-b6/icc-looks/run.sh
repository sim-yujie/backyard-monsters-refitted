#!/bin/sh
# run.sh <variant a|b|c> <mode> : one Blender run of icc.py, holding the PC-wide Blender lock (one Blender at a time).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
LOCK="C:/Coding/BYMR/blender-lock"
cd "$(dirname "$0")"
until mkdir "$LOCK" 2>/dev/null; do echo "waiting for the Blender lock"; sleep 120; done
"$BL" -b --factory-startup -P icc.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|CHECK\|CLEAR\|GAP\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -${PB_LINES:-60}
rmdir "$LOCK"
