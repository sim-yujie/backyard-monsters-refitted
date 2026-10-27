#!/bin/sh
# Render body + 32 headings for each named tier (default all four), one after another.
cd "$(dirname "$0")"
BL="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
for t in ${@:-t1 t1b t2 t3}; do
  start=$(date +%s)
  "$BL" -b --factory-startup -P cannon3d.py -- $t all 2>&1 | grep -E "DONE|Error|Traceback|out of memory" 
  echo "$t took $(( $(date +%s) - start )) s"
done
