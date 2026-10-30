#!/bin/sh
# batch.sh "<level> <mode>" ... : goo2.py runs one after another, each started as soon as no other Blender is running
# (polled every second, so short gaps between other helpers' runs are used). Output lines to work/batch.log.
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
for job in "$@"; do
    while tasklist 2>/dev/null | grep -qi "^blender.exe"; do sleep 1; done
    echo "== $job $(date +%T)" >> work/batch.log
    "$BL" -b --factory-startup -P goo2.py -- $job 2>&1 | grep -i "error\|Traceback\|DONE\|CHECK\|GAP\|PROBE\|Saved" | grep -v "^Fra:" >> work/batch.log
done
echo "== end $(date +%T)" >> work/batch.log
