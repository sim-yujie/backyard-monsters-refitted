#!/bin/sh
# Render every downloaded AI model in ai-models/ (Meshy / Tripo .glb, owner, 28 Oct) in the tier 2 camera, into
# render/ai/<name>.png, then rebuild cannon-compare.png with them as extra columns. Comparison only, not for the game.
cd "$(dirname "$0")"
BL="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
mkdir -p render/ai
for m in ai-models/*.glb; do
  [ -e "$m" ] || continue
  n=$(basename "$m" .glb)
  "$BL" -b --factory-startup -P ai_render.py -- "$m" t2 "render/ai/$n.png" ${TURN:-0} 2>&1 | grep -E "BOX|DONE|Error|Traceback"
done
python cannon_compare.py
