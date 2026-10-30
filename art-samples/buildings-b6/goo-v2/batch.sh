#!/bin/sh
# batch.sh "<level> <mode>" ... : goo2.py runs one after another, each started once fewer than 2 Blenders run on the PC
# (the shared limit; polled every second). Output lines to work/batch.log (or $BATCH_LOG).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")"
for job in "$@"; do
    while [ "$(tasklist 2>/dev/null | grep -ci "^blender.exe")" -ge 2 ]; do sleep 1; done
    echo "== $job $(date +%T)" >> "${BATCH_LOG:-work/batch.log}"
    "$BL" -b --factory-startup -P goo2.py -- $job 2>&1 | grep -i "error\|Traceback\|DONE\|CHECK\|GAP\|PROBE\|Saved" | grep -v "^Fra:" >> "${BATCH_LOG:-work/batch.log}"
done
echo "== end $(date +%T)" >> "${BATCH_LOG:-work/batch.log}"
