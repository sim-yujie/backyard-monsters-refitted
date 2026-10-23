#!/bin/bash
# usage: queue.sh <job list file> : runs job.sh for every line ("sheet mode col [extras]"), at most 3 Codex calls at once.
K=$(cd "$(dirname "$0")" && pwd)
grep -v '^#' "$1" | grep . | xargs -P 3 -L 1 bash "$K/job.sh"
echo ALLDONE
