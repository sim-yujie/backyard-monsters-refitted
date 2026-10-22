#!/bin/bash
cd D:/Coding/BYMR/art-trials/rezghul-anim/full
for n in "$@"; do
  bash go2.sh $n || { echo STOP; exit 1; }
  python build_h.py $n > h$n/build.log 2>&1 || echo "build fail $n"
  python clean.py $n; echo "built $n: $(grep -c clipped h$n/build.log)"
done
