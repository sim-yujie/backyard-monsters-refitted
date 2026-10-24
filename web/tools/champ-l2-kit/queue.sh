#!/bin/bash
# usage: queue.sh <job list file> : runs job.sh for every line ("sheet mode col [extras]"), at most 2 Codex calls at once (the level 3 helper runs Codex too).
K=$(cd "$(dirname "$0")" && pwd)
grep -v '^#' "$1" | grep . | xargs -P 2 -L 1 bash "$K/job.sh"
echo ALLDONE
