#!/bin/sh
# anims.sh <mode>:<tier>... : Blender runs one after another (e.g. still:2 anim:2), logs in archive/logs.
cd "$(dirname "$0")"
for job in "$@"; do
  m=${job%%:*}; t=${job##*:}
  PB_LINES=400 ../run.sh "$PWD/clean3d.py" "$t" "$m" > "D:/Coding/BYMR/archive/logs/bone-clean-$m$t.log" 2>&1
  echo "$m $t finished $(date +%H:%M:%S)" >> D:/Coding/BYMR/archive/logs/bone-clean-anims.log
done
