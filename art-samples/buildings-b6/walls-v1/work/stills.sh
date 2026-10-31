#!/bin/sh
cd "$(dirname "$0")/.."
for k in "$@"; do ./run.sh $k still; echo "LOOK $k finished $(date +%T)"; done
