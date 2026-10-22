#!/bin/bash
cd D:/Coding/BYMR/art-trials/slimeattikus-anim/full
for n in "$@"; do
  bash go2.sh $n || { echo STOP; exit 1; }
  python build_h.py $n > h$n/build.log 2>&1 || echo "build fail $n"
  echo "built $n: $(grep -c clipped h$n/build.log)"
done
