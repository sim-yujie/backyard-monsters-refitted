#!/bin/sh
# renderall.sh <name> [levels...] [-- anim <level> [<level> ...]] : the sample renders of one building at 8x
# (B3D_SCALE=2), one Blender at a time: the stills, then one producing loop per anim level.
# Example: sh renderall.sh twig 1 3 6 10 -- anim 1 3 6 10
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
n=$1; shift
while [ $# -gt 0 ] && [ "$1" != "--" ]; do
  B3D_SCALE=2 B3D_SAMPLES=${STILL_SAMPLES:-32} "$BL" -b --factory-startup -P ${n}3d.py -- $1 still 2>&1 | grep -i "error\|Traceback\|DONE"
  shift
done
if [ "$1" = "--" ]; then
  shift 2
  for lv in "$@"; do
    B3D_SCALE=2 B3D_SAMPLES=${ANIM_SAMPLES:-16} "$BL" -b --factory-startup -P ${n}3d.py -- $lv anim ${FRAMES:-36} 2>&1 | grep -i "error\|Traceback\|DONE"
  done
fi
