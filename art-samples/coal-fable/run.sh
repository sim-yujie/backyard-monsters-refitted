#!/bin/sh
# run.sh <tier> <mode> [args] : one Blender run of coal.py, holding the PC's one-Blender lock while it renders.
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
LOCK=C:/Coding/BYMR/blender-lock
cd "$(dirname "$0")"
n=0
until mkdir "$LOCK" 2>/dev/null; do
  n=$((n+1)); [ $n -gt 40 ] && { echo "LOCK busy"; exit 9; }
  sleep 15
done
"$BL" -b --factory-startup -P coal.py -- "$@" 2>&1 | grep -iE "error|Traceback|DONE|PROBE|CHECK|CLEAR|GAP|line [0-9]|Exception" | grep -v "^Fra:" | head -${PB_LINES:-30}
rmdir "$LOCK"
