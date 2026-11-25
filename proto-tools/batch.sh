#!/bin/bash
# Shoots every option at every size: bash batch.sh <outdir> "<look W H scale>"...
cd "$(dirname "$0")"
export NODE_OPTIONS=--no-webstorage
out=$1; shift
for t in "$@"; do
  timeout 900 node shoot.mjs $t $out 2>&1 | grep -v "404\|^    at " | tail -n 2
done
echo BATCH-DONE
