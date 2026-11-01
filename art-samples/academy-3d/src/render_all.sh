#!/bin/sh
# render_all.sh [levels...] : every level's still and loop (default 1 2 3 4), then the comparison pictures.
# Run from anywhere with Git Bash / sh. Takes about 2.5 minutes a level on an RTX 3070 (still + 21-frame loop); 11 minutes for all four.
cd "$(dirname "$0")"
BL="${BLENDER:-C:/Program Files/Blender Foundation/Blender 5.2/blender.exe}"
LEVELS="${*:-1 2 3 4}"
for l in $LEVELS; do
  for m in still anim; do
    echo "== L$l $m $(date +%T)"
    "$BL" -b --factory-startup -P academy.py -- $l $m 2>&1 | grep -i "error\|Traceback\|DONE" | grep -v "^Fra:"
  done
done
for l in $LEVELS; do
  python post.py side $l
  python post.py anim $l
done
[ "$LEVELS" = "1 2 3 4" ] && python post.py levels && python post.py game
echo "== ALL DONE $(date +%T)"
