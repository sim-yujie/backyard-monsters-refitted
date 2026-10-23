#!/bin/bash
# usage: queue.sh <queue file>  ; each line: <dir> <input png>...  ; runs 3 at a time, appends to queue.log
cd /d/Coding/BYMR/art-trials/champions/_kit/l3
xargs -P ${P:-3} -L 1 bash -c 'bash run.sh "$0" "$@" > /dev/null 2>&1; echo "$0 exit $?" >> queue.log' < "$1"
echo "ALLDONE $1" >> queue.log
