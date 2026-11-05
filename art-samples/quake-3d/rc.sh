#!/bin/sh
# rc.sh T OUT CELL [CELL ...] : take the Blender lock, render T's cells, release, write a Flash/3D sheet cropped to the tower
cd "$(dirname "$0")"
T=$1; OUT=$2; shift 2
until mkdir C:/Coding/BYMR/blender-lock 2>/dev/null; do sleep 30; done
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P quake3d.py -- $T cell "$@" 2>&1 | grep -i "error\|Traceback\|line [0-9]" | head -20
rmdir C:/Coding/BYMR/blender-lock
specs=""; for c in "$@"; do specs="$specs $T:cell:$c"; done
python compare.py "$OUT" $specs
