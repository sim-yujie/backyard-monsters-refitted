#!/bin/bash
# all.sh : every round-3 render, one Blender at a time (each run takes and returns the GPU lock).
cd "$(dirname "$0")"
for L in 1 2 3; do
  ./run.sh $L still && cp render/L$L-parts-00.png render/L$L-parts12.png
  PB_STATE=damaged ./run.sh $L base
  PB_K=6 PB_EXTRA=1 ./run.sh $L anim
done
PB_STATE=destroyed ./run.sh 1 base
for L in 1 2 3; do CHECK_EVERY=24 ./run.sh $L check > work/check-L$L.log 2>&1; done
./run.sh 3 gap > work/gap-L3.log 2>&1
echo ALLDONE
