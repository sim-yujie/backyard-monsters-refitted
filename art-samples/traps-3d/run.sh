#!/bin/sh
# run.sh <look> <mode> [states] : one Blender run of traps.py, holding the PC's one Blender lock
# (C:/Coding/BYMR/blender-lock: made = ours; there already = wait 2 min and try again).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
LOCK=C:/Coding/BYMR/blender-lock
cd "$(dirname "$0")"
until mkdir "$LOCK" 2>/dev/null; do echo "waiting for the Blender lock"; sleep 120; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
"$BL" -b --factory-startup -P traps.py -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|CONTACT\|STATE\|line [0-9]" | grep -v "^Fra:" | head -${PB_LINES:-60}
